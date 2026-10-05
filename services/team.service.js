const Team = require("../models/Team");
const User = require("../models/User");
const Task = require("../models/Task");

const populateTeam = async (teamId) => {
  return Team.findById(teamId)
    .populate("leaderId", "profile email role")
    .populate("memberIds", "profile email role teamId managerId");
};

const ensureLeaderEligible = async (leaderId, teamIdToExclude = null) => {
  const leader = await User.findById(leaderId);
  if (!leader) {
    throw new Error("Leader user not found");
  }

  if (leader.role !== "team_lead") {
    throw new Error("Selected leader must have role team_lead");
  }

  const leadingAnotherTeam = await Team.findOne({
    leaderId,
    ...(teamIdToExclude ? { _id: { $ne: teamIdToExclude } } : {}),
  }).select("_id");

  if (leadingAnotherTeam) {
    throw new Error("This team lead is already leading another team");
  }

  return leader;
};

/**
 *  Create a new team
 *  @param {Object} teamData
 *  @returns {Object}
 */

const createTeam = async (teamData) => {
  const { name, description, leaderId } = teamData;

  const existingTeam = await Team.findOne({ name });
  if (existingTeam) {
    throw new Error("Team name already exists");
  }

  const leader = await ensureLeaderEligible(leaderId);

  if (leader.teamId) {
    throw new Error("This user already belongs to a team");
  }

  const team = await Team.create({
    name,
    description: description || "",
    leaderId,
    memberIds: [leaderId],
  });

  // Update leader's teamId/managerId
  await User.findByIdAndUpdate(
    leaderId,
    { teamId: team._id, managerId: null },
    { new: true }
  );

  return team.populate("leaderId", "profile.fullName email role");
};

/**
 * Get all teams with pagination
 * @param {Number} page
 * @param {Number} limit
 * @returns {Object}
 */

const getAllTeams = async (page = 1, limit = 10) => {
  const skip = (page - 1) * limit;

  const total = await Team.countDocuments();
  const teams = await Team.find()
    .skip(skip)
    .limit(limit)
    .populate("leaderId", "profile email")
    .populate("memberIds", "profile email role")
    .sort({ createdAt: -1 });

  return {
    teams,
    pagination: {
      current: page,
      total: Math.ceil(total / limit),
      count: teams.length,
      totalRecords: total,
    },
  };
};

/**
 * Get team by ID with all details
 * @param {String} teamId
 * @returns {Object|null}
 */

const getTeamById = async (teamId) => {
  return await Team.findById(teamId)
    .populate("leaderId", "profile email phone")
    .populate("memberIds", "profile email role");
};

/**
 * Update team info
 * @param {String} teamId
 * @param {Object} updateData
 * @returns {Object}
 */

const updateTeam = async (teamId, updateData) => {
  const { name, description, leaderId } = updateData;

  if (name) {
    const existingTeam = await Team.findOne({ name, _id: { $ne: teamId } });
    if (existingTeam) {
      throw new Error("Team name already exists");
    }
  }

  // NOTE: leader changes should use assignTeamLead to keep membership/managerId consistent.
  // We still accept leaderId here for backward compatibility.
  if (leaderId) {
    await assignTeamLead(teamId, leaderId);
  }

  const updated = await Team.findByIdAndUpdate(
    teamId,
    {
      ...(name !== undefined && name !== null && { name }),
      ...(description !== undefined && description !== null && { description }),
      updatedAt: new Date(),
    },
    { new: true, runValidators: true }
  );

  return populateTeam(updated._id);
};

/**
 * Delete (soft) team by ID
 * @param {String} teamId
 * @returns {Object}
 */

const deleteTeam = async (teamId) => {
  const team = await Team.findById(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  // Check if team has active tasks (if Task model exists)
  const activeTasks = await Task.findOne({
    teamId,
    status: { $ne: "completed" },
  });
  if (activeTasks) {
    throw new Error("Cannot delete team with active tasks");
  }

  // Remove teamId/managerId from all members
  await User.updateMany({ teamId }, { $unset: { teamId: 1, managerId: 1 } });

  // Delete team
  return await Team.findByIdAndDelete(teamId);
};

/**
 * Add members to a team
 * @param {String} teamId
 * @param {String} userIds - Array of user IDs
 * @returns {Object}
 */

const addMember = async (teamId, userId) => {
  const team = await Team.findById(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  const user = await User.findById(userId);
  if (!user) {
    throw new Error("User not found");
  }

  if (user.teamId && user.teamId.toString() !== teamId.toString()) {
    throw new Error("This user already belongs to another team");
  }

  // Prevent a team lead who already leads another team from joining a different team
  if (user.role === "team_lead") {
    const leadingAnotherTeam = await Team.findOne({
      leaderId: userId,
      _id: { $ne: teamId },
    }).select("_id");
    if (leadingAnotherTeam) {
      throw new Error("This team lead is already leading another team");
    }
  }

  if (team.memberIds.includes(userId)) {
    throw new Error("User already in this team");
  }

  team.memberIds.push(userId);
  await team.save();

  await User.findByIdAndUpdate(
    userId,
    { teamId, managerId: team.leaderId },
    { new: true }
  );

  return populateTeam(team._id);
};

/**
 * Remove member from a team
 * @param {String} teamId
 * @param {String} userId
 * @returns {Object}
 */

const removeMember = async (teamId, userId) => {
  const team = await Team.findById(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  if (team.leaderId.toString() === userId) {
    throw new Error(
      "Cannot remove the team leader from the team. Assign a new leader before removing."
    );
  }

  team.memberIds = team.memberIds.filter((id) => id.toString() !== userId);
  await team.save();

  await User.findByIdAndUpdate(userId, { $unset: { teamId: 1, managerId: 1 } });

  return populateTeam(team._id);
};

/**
 * Assign new team leader
 * @param {String} teamId
 * @param {String} newLeaderId
 * @returns {Object}
 */
const assignTeamLead = async (teamId, newLeaderId) => {
  const team = await Team.findById(teamId);
  if (!team) {
    throw new Error("Team not found");
  }

  const newLeader = await ensureLeaderEligible(newLeaderId, teamId);

  if (newLeader.teamId && newLeader.teamId.toString() !== teamId.toString()) {
    throw new Error("This user already belongs to another team");
  }

  const currentLeaderId = team.leaderId?.toString();
  const isSameLeader = currentLeaderId === newLeaderId.toString();

  // Leader swap rules:
  // - new leader is auto-added to members
  // - old leader is auto-removed from members
  // - members managerId is updated to new leader
  if (!team.memberIds.some((id) => id.toString() === newLeaderId.toString())) {
    team.memberIds.push(newLeaderId);
  }

  if (!isSameLeader && currentLeaderId) {
    team.memberIds = team.memberIds.filter(
      (id) => id.toString() !== currentLeaderId
    );
  }

  team.leaderId = newLeaderId;
  await team.save();

  // Update old leader to no-team (do not mutate role)
  if (!isSameLeader && currentLeaderId) {
    await User.findByIdAndUpdate(currentLeaderId, {
      $unset: { teamId: 1, managerId: 1 },
    });
  }

  // New leader belongs to this team; no manager
  await User.findByIdAndUpdate(newLeaderId, { teamId, managerId: null });

  // All other members belong to this team; manager is new leader
  await User.updateMany(
    {
      _id: {
        $in: team.memberIds.filter(
          (id) => id.toString() !== newLeaderId.toString()
        ),
      },
    },
    { teamId, managerId: newLeaderId }
  );

  return populateTeam(team._id);
};

/**
 * Get available team leaders (team_lead), with status if already leading another team.
 * @param {String|null} excludeTeamId
 */
const getAvailableLeaders = async (excludeTeamId = null) => {
  const leaders = await User.find({ isActive: true, role: "team_lead" })
    .select("_id email role profile teamId managerId")
    .populate("teamId", "name");

  const leadingTeams = await Team.find({
    leaderId: { $in: leaders.map((u) => u._id) },
    ...(excludeTeamId ? { _id: { $ne: excludeTeamId } } : {}),
  }).select("leaderId");

  const leadingSet = new Set(leadingTeams.map((t) => t.leaderId.toString()));

  return leaders.map((u) => ({
    ...u.toObject(),
    isLeadingAnotherTeam: leadingSet.has(u._id.toString()),
  }));
};

/**
 * Get all members of a team
 * @param {String} teamId
 * @returns {Array}
 */

const getTeamMembers = async (teamId) => {
  const members = await User.find({ teamId }).select(
    "_id email role department profile"
  );

  return members;
};

const getAllMembers = async () => {
  return await User.find().select("_id email role department profile");
};

module.exports = {
  createTeam,
  getAllTeams,
  getTeamById,
  updateTeam,
  deleteTeam,
  addMember,
  removeMember,
  assignTeamLead,
  getAvailableLeaders,
  getTeamMembers,
  getAllMembers,
};
