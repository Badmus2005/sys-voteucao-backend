import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();
const MAX_CODES_PER_REQUEST = 1000;
const CODE_EXPIRATION_DAYS = 30;

/**
 * POST /code/generate
 * Génère des codes d'inscription uniques
 */
router.post('/generate', authenticateToken, async (req, res) => {
    try {
        const { quantity } = req.body;

        // Validation manuelle
        if (!quantity || isNaN(quantity) || quantity < 1 || quantity > MAX_CODES_PER_REQUEST) {
            return res.status(400).json({
                success: false,
                message: `Le nombre de codes doit être un entier entre 1 et ${MAX_CODES_PER_REQUEST}`
            });
        }

        const batchId = `BATCH-${Date.now()}`;
        const expiresAt = new Date(Date.now() + CODE_EXPIRATION_DAYS * 24 * 60 * 60 * 1000);

        // Génération des codes
        const codes = [];
        for (let i = 0; i < quantity; i++) {
            const code = await generateUniqueCode();
            const created = await prisma.registrationCode.create({
                data: {
                    code,
                    batchId,
                    generatedBy: req.user.id,
                    expiresAt,
                }
            });
            codes.push(created.code);
        }

        res.json({
            success: true,
            count: codes.length,
            batchId,
            codes
        });

    } catch (err) {
        console.error("Erreur code/generate:", err);
        res.status(500).json({
            success: false,
            message: "Erreur lors de la génération des codes"
        });
    }
});

/**
 * GET /code/codes
 * Liste tous les codes existants avec pagination basique
 */
router.get('/codes', authenticateToken, async (req, res) => {
    try {
        const { page = 1, limit = 50 } = req.query;
        const skip = (parseInt(page) - 1) * parseInt(limit);

        const [codes, total] = await Promise.all([
            prisma.registrationCode.findMany({
                skip,
                take: parseInt(limit),
                orderBy: { createdAt: 'desc' },
                include: {
                    generatedByUser: {
                        select: { email: true }
                    }
                }
            }),
            prisma.registrationCode.count()
        ]);

        res.json({
            success: true,
            count: codes.length,
            total,
            page: parseInt(page),
            pages: Math.ceil(total / limit),
            codes: codes.map(code => ({
                code: code.code,
                createdAt: code.createdAt,
                expiresAt: code.expiresAt,
                used: code.used,
                generatedBy: code.generatedByUser?.email
            }))
        });

    } catch (err) {
        console.error("Erreur code/codes:", err);
        res.status(500).json({
            success: false,
            message: "Erreur serveur"
        });
    }
});

// Helper function pour générer un code unique
async function generateUniqueCode() {
    let code;
    let exists = true;
    let attempts = 0;
    const MAX_ATTEMPTS = 5;

    while (exists && attempts < MAX_ATTEMPTS) {
        code = 'UCAO-' +
            Math.random().toString(36).substring(2, 6).toUpperCase() + '-' +
            Math.random().toString(36).substring(2, 6).toUpperCase();

        const found = await prisma.registrationCode.findUnique({
            where: { code }
        });
        exists = !!found;
        attempts++;
    }

    if (exists) {
        throw new Error('Impossible de générer un code unique après plusieurs tentatives');
    }

    return code;
}

export default router;