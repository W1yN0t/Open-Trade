import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const KEY_LEN = 32;
const SALT_LEN = 32;
const IV_LEN = 12;

function deriveKey(password: string, salt: Buffer): Buffer {
  return scryptSync(password, salt, KEY_LEN) as Buffer;
}

function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = (cipher as ReturnType<typeof createCipheriv> & { getAuthTag(): Buffer }).getAuthTag();
  return `${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
}

function decrypt(encoded: string, key: Buffer): string {
  const parts = encoded.split(':');
  if (parts.length !== 3) throw new Error('Invalid encoded format');
  const [ivHex, tagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const tag = Buffer.from(tagHex, 'hex');
  const ciphertext = Buffer.from(cipherHex, 'hex');
  const decipher = createDecipheriv('aes-256-gcm', key, iv) as ReturnType<typeof createDecipheriv> & {
    setAuthTag(tag: Buffer): void;
  };
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export interface RawCredentials {
  apiKey: string;
  apiSecret: string;
  password?: string;
  [key: string]: string | undefined;
}

export class CredentialService {
  constructor(private readonly prisma: PrismaClient) {}

  async store(userId: string, provider: string, credentials: RawCredentials, masterPassword: string): Promise<void> {
    const salt = randomBytes(SALT_LEN);
    const key = deriveKey(masterPassword, salt);
    const encryptedKey = encrypt(credentials.apiKey, key);
    const encryptedSecret = encrypt(credentials.apiSecret, key);
    const encryptedPassword = credentials.password ? encrypt(credentials.password, key) : null;

    await this.prisma.userCredentials.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, encryptedKey, encryptedSecret, encryptedPassword, salt: salt.toString('hex') },
      update: { encryptedKey, encryptedSecret, encryptedPassword, salt: salt.toString('hex') },
    });
  }

  async load(userId: string, provider: string, masterPassword: string): Promise<RawCredentials> {
    const row = await this.prisma.userCredentials.findUnique({
      where: { userId_provider: { userId, provider } },
    });
    if (!row) throw new Error(`No credentials found for provider "${provider}"`);

    const salt = Buffer.from(row.salt, 'hex');
    const key = deriveKey(masterPassword, salt);

    try {
      return {
        apiKey: decrypt(row.encryptedKey, key),
        apiSecret: decrypt(row.encryptedSecret, key),
        password: row.encryptedPassword ? decrypt(row.encryptedPassword, key) : undefined,
      };
    } catch {
      throw new Error('Invalid master password or corrupted credentials');
    }
  }

  async remove(userId: string, provider: string): Promise<boolean> {
    try {
      await this.prisma.userCredentials.delete({ where: { userId_provider: { userId, provider } } });
      return true;
    } catch {
      return false;
    }
  }

  async list(userId: string): Promise<string[]> {
    const rows = await this.prisma.userCredentials.findMany({
      where: { userId },
      select: { provider: true },
      orderBy: { provider: 'asc' },
    });
    return rows.map((r: { provider: string }) => r.provider);
  }
}
