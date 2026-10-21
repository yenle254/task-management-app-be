const bcrypt = require('bcryptjs');
const { PASSWORD } = require('../utils/constants.utils');

const hashPassword = async (password) => {
    const salt = await bcrypt.genSalt(PASSWORD.SALT_ROUNDS);
    return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
    return await bcrypt.compare(password, hashedPassword);
};

module.exports = {
    hashPassword,
    comparePassword
};







