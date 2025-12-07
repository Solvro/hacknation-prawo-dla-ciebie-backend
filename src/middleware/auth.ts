import { Request, Response, NextFunction } from 'express';

const API_TOKEN = process.env.OFFICIAL_API_TOKEN || "super-secret-official-token";

export const officialAuthMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // 1. Check Authorization header (Bearer token)
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({ error: 'Authorization header missing' });
    }

    // 2. Extract token
    const token = authHeader.split(' ')[1];

    // 3. Verify token
    if (token !== API_TOKEN) {
        return res.status(403).json({ error: 'Invalid authentication token' });
    }

    next();
};
