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
 * Generates a 24-character single-use role activation token
 * Format: KOMA-XXXX-XXXX-XXXX-XXXX (24 characters total)
 */
export function generateRoleActivationToken(): string {
  // Use readable charset avoiding ambiguous characters
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const getRandomBlock = (len: number) => {
    let res = '';
    for (let i = 0; i < len; i++) {
      res += charset[crypto.randomInt(0, charset.length)];
    }
    return res;
  };

  return `KOMA-${getRandomBlock(4)}-${getRandomBlock(4)}-${getRandomBlock(4)}-${getRandomBlock(4)}`;
}
