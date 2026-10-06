/**
 * Auth Service Unit Tests
 */
const bcrypt = require('bcryptjs');
const { hashPassword, comparePassword } = require('../../../services/auth.service');

describe('AuthService', () => {
  describe('hashPassword()', () => {
    it('should hash a password successfully', async () => {
      const password = 'testPassword123';
      const hashedPassword = await hashPassword(password);

      expect(hashedPassword).toBeDefined();
      expect(hashedPassword).not.toBe(password);
      expect(hashedPassword.length).toBeGreaterThan(0);
    });

    it('should generate different hashes for the same password (due to salt)', async () => {
      const password = 'testPassword123';
      const hash1 = await hashPassword(password);
      const hash2 = await hashPassword(password);

      expect(hash1).not.toBe(hash2);
    });

    it('should generate a hash with correct bcrypt format', async () => {
      const password = 'testPassword123';
      const hashedPassword = await hashPassword(password);

      // bcrypt hashes start with $2a$, $2b$, or $2y$ and have format: $2$[cost]$[22 chars salt][31 chars hash]
      expect(hashedPassword).toMatch(/^\$2[aby]?\$\d{1,2}\$[./A-Za-z0-9]{53}$/);
    });

    it('should hash empty string', async () => {
      const hashedPassword = await hashPassword('');

      expect(hashedPassword).toBeDefined();
      expect(hashedPassword.length).toBeGreaterThan(0);
    });

    it('should hash long password', async () => {
      const password = 'a'.repeat(100);
      const hashedPassword = await hashPassword(password);

      expect(hashedPassword).toBeDefined();
      expect(hashedPassword.length).toBeGreaterThan(0);
    });
  });

  describe('comparePassword()', () => {
    it('should return true for matching password', async () => {
      const password = 'testPassword123';
      const hashedPassword = await hashPassword(password);

      const result = await comparePassword(password, hashedPassword);

      expect(result).toBe(true);
    });

    it('should return false for non-matching password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword456';
      const hashedPassword = await hashPassword(password);

      const result = await comparePassword(wrongPassword, hashedPassword);

      expect(result).toBe(false);
    });

    it('should return false for empty password', async () => {
      const password = 'testPassword123';
      const hashedPassword = await hashPassword(password);

      const result = await comparePassword('', hashedPassword);

      expect(result).toBe(false);
    });

    it('should throw error for null password', async () => {
      const password = 'testPassword123';
      const hashedPassword = await hashPassword(password);

      await expect(comparePassword(null, hashedPassword)).rejects.toThrow();
    });

    it('should throw error for undefined password', async () => {
      const password = 'testPassword123';
      const hashedPassword = await hashPassword(password);

      await expect(comparePassword(undefined, hashedPassword)).rejects.toThrow();
    });

    it('should return false for case-sensitive passwords', async () => {
      const password = 'TestPassword123';
      const wrongCasePassword = 'testpassword123';
      const hashedPassword = await hashPassword(password);

      const result = await comparePassword(wrongCasePassword, hashedPassword);

      expect(result).toBe(false);
    });

    it('should return false for password with whitespace differences', async () => {
      const password = 'testPassword123';
      const wrongPassword = ' testPassword123';
      const hashedPassword = await hashPassword(password);

      const result = await comparePassword(wrongPassword, hashedPassword);

      expect(result).toBe(false);
    });

    it('should return false for invalid hash', async () => {
      const result = await comparePassword('password', 'invalid_hash');

      expect(result).toBe(false);
    });
  });
});
