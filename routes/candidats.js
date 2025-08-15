import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();


// Déposer une candidature à une élection
router.post('/candidature', authenticateToken, async (req, res) => {
    try {
        const { electionId, nom, prenom, programme } = req.body;
        const userId = req.user.id;
        if (!userId || !electionId || !nom || !prenom) {
            return res.status(400).json({ message: 'Champs requis manquants' });
        }
        // Vérifier que l'utilisateur existe
        const user = await prisma.user.findUnique({ where: { id: userId } });
        if (!user) {
            return res.status(400).json({ message: 'Utilisateur inexistant' });
        }
        // Vérifier que l'élection existe
        const election = await prisma.election.findUnique({ where: { id: electionId } });
        if (!election) {
            return res.status(400).json({ message: 'Élection inexistante' });
        }
        // Vérifier que l'utilisateur n'est pas déjà candidat à cette élection
        const existingCandidate = await prisma.candidate.findFirst({ where: { userId, electionId } });
        if (existingCandidate) {
            return res.status(400).json({ message: 'Vous êtes déjà candidat à cette élection.' });
        }
        // Créer la candidature
        const candidate = await prisma.candidate.create({
            data: {
                nom,
                prenom,
                programme: programme || null,
                userId,
                electionId
            }
        });
        res.status(201).json({ message: 'Candidature déposée avec succès', candidate });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Mise à jour du programme d'un candidat (propriétaire)
router.put('/:candidateId/programme', authenticateToken, async (req, res) => {
    try {
        const candidateId = parseInt(req.params.candidateId);
        const { programme } = req.body;
        if (isNaN(candidateId) || !programme) {
            return res.status(400).json({ message: 'Paramètres invalides' });
        }
        const candidate = await prisma.candidate.findUnique({ where: { id: candidateId } });
        if (!candidate) return res.status(404).json({ message: 'Candidat introuvable' });
        if (candidate.userId !== req.user.id) return res.status(403).json({ message: 'Non autorisé' });
        const updated = await prisma.candidate.update({ where: { id: candidateId }, data: { programme } });
        res.json({ message: 'Programme mis à jour', candidate: updated });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Liste des candidats par élection
router.get('/:electionId', async (req, res) => {
    try {
        const electionId = parseInt(req.params.electionId);
        if (isNaN(electionId)) {
            return res.status(400).json({ message: 'ElectionId invalide' });
        }

        const candidates = await prisma.candidate.findMany({
            where: { electionId }
        });

        res.json(candidates);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Ajouter un candidat à une élection
router.post('/', async (req, res) => {
    try {
        const { nom, prenom, userId, electionId, programme, photoUrl } = req.body;

        if (!nom || !prenom || !userId || !electionId) {
            return res.status(400).json({ message: 'Champs requis manquants' });
        }

        // Vérifier que userId existe dans User (optionnel, mais recommandé)
        const userExists = await prisma.user.findUnique({ where: { id: userId } });
        if (!userExists) {
            return res.status(400).json({ message: 'Utilisateur inexistant' });
        }

        // Vérifier que electionId existe dans Election
        const electionExists = await prisma.election.findUnique({ where: { id: electionId } });
        if (!electionExists) {
            return res.status(400).json({ message: 'Élection inexistante' });
        }

        const candidate = await prisma.candidate.create({
            data: {
                nom,
                prenom,
                programme: programme || null,
                photoUrl: photoUrl || null,
                userId,
                electionId
            }
        });

        res.status(201).json(candidate);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

export default router;
