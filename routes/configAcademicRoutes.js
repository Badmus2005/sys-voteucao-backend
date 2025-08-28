import express from 'express';
import { ACADEMIC } from '../shared/academicData.js';

const router = express.Router();

router.get('/config-academic', (req, res) => {
    try {
        const filieres = Object.values(ACADEMIC.ECOLES).flat();
        const ecoles = Object.keys(ACADEMIC.ECOLES);
        const annees = ACADEMIC.ANNEES;

        res.json({
            success: true,
            data: {
                filieres,
                ecoles,
                annees
            }
        });
    } catch (error) {
        console.error('Erreur /config-academic:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors du chargement de la configuration académique'
        });
    }
});

export default router;
