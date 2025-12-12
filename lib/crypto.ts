import crypto from 'crypto';

// Ensure the key is 32 bytes
const getSecretKey = () => {
    const key = process.env.ENCRYPTION_KEY || 'secure-bank-interview-app-secret-key-2025';
    return crypto.createHash('sha256').update(key).digest();
};

const ALGORITHM = 'aes-256-gcm';

export const encrypt = (text: string): string => {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv(ALGORITHM, getSecretKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag().toString('hex');
    return `${iv.toString('hex')}:${authTag}:${encrypted}`;
};

export const decrypt = (text: string): string => {
    try {
        const parts = text.split(':');
        if (parts.length !== 3) return text; // Not encrypted or invalid format

        const [ivHex, authTagHex, encryptedHex] = parts;

        const decipher = crypto.createDecipheriv(
            ALGORITHM,
            getSecretKey(),
            Buffer.from(ivHex, 'hex')
        );

        decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));

        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    } catch (error) {
        console.error("Decryption failed:", error);
        return text; // Return original if decryption fails (e.g. legacy cleartext)
    }
};
