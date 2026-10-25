import crypto from 'node:crypto';

/**
 * Generates a cryptographically strong 12-digit pickup code
 * e.g. "482910573912"
 */
export function generatePickupCode(): string {
  // Generate 12 digits using secure random bytes
  let code = '';
  while (code.length < 12) {
    const num = crypto.randomInt(0, 1000000).toString().padStart(6, '0');
    code += num;
  }
  return code.slice(0, 12);
}

/**
 * Formats 12-digit code into user-friendly blocks
 * e.g. "4829 - 1057 - 3912"
 */
export function formatPickupCode(code: string): string {
  const clean = code.replace(/\D/g, '');
  if (clean.length !== 12) return code;
  return `${clean.slice(0, 4)} - ${clean.slice(4, 8)} - ${clean.slice(8, 12)}`;
}

/**
 * Generates random 32-character hex salt
 */
export function generateSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Hashes 12-digit code with per-order salt using SHA-256
 */
export function hashPickupCode(code: string, salt: string): string {
  const cleanCode = code.replace(/\D/g, '');
  return crypto.createHash('sha256').update(`${cleanCode}:${salt}`).digest('hex');
}

/**
 * Constant-time safe verification of 12-digit code against stored hash
 */
export function verifyPickupCode(enteredCode: string, salt: string, expectedHash: string): boolean {
  if (!enteredCode || !salt || !expectedHash) return false;
  const calculatedHash = hashPickupCode(enteredCode, salt);
  
  if (calculatedHash.length !== expectedHash.length) return false;
  
  const bufA = Buffer.from(calculatedHash, 'utf8');
  const bufB = Buffer.from(expectedHash, 'utf8');
  
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Generates a high-entropy 24-character cryptographically secure cipher
 * Combines uppercase letters, lowercase letters, digits, and symbols
 * e.g. "k9$W#mP2!xL8@vQ7^zR4+yT1"
 */
export function generateRoleActivationToken(): string {
  // 70+ diverse characters: uppercase, lowercase, numbers, and symbols
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*_+=-?';
  let token = '';
  for (let i = 0; i < 24; i++) {
    token += charset[crypto.randomInt(0, charset.length)];
  }
  return token;
}
