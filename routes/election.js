import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import VoteToken from '../models/VoteToken.js';

const router = express.Router();


// Récupérer toutes les élections actives
router.get('/', async (req, res) => {
    try {
        const elections = await prisma.election.findMany({
            where: { isActive: true },
            include: {
                candidates: {
                    include: {
                        user: {
                            include: {
                                etudiant: true
                            }
                        }
                    }
                },
                _count: {
                    select: { votes: true }
                }
            },
            orderBy: { dateDebut: 'desc' }
        });

        res.json(elections);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Récupérer les élections par type et niveau
router.get('/by-type/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { filiere, annee, ecole } = req.query;

        let whereClause = {
            type: type.toUpperCase(),
            isActive: true
        };

        // Filtres selon le type d'élection
        if (type === 'SALLE') {
            if (filiere) whereClause.filiere = filiere;
            if (annee) whereClause.annee = parseInt(annee);
        } else if (type === 'ECOLE') {
            if (ecole) whereClause.ecole = ecole;
        }

        const elections = await prisma.election.findMany({
            where: whereClause,
            include: {
                candidates: {
                    include: {
                        user: {
                            include: {
                                etudiant: true
                            }
                        }
                    }
                },
                _count: {
                    select: { votes: true }
                }
            },
            orderBy: { dateDebut: 'desc' }
        });

        res.json(elections);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Créer une nouvelle élection (admin seulement)
router.post('/', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const { type, titre, description, dateDebut, dateFin, filiere, annee, ecole } = req.body;

        // Validation des données selon le type
        if (type === 'SALLE' && (!filiere || !annee)) {
            return res.status(400).json({
                message: 'Les élections par salle nécessitent filière et année'
            });
        }

        if (type === 'ECOLE' && !ecole) {
            return res.status(400).json({
                message: 'Les élections par école nécessitent le nom de l\'école'
            });
        }

        const election = await prisma.election.create({
            data: {
                type: type.toUpperCase(),
                titre,
                description,
                dateDebut: new Date(dateDebut),
                dateFin: new Date(dateFin),
                filiere,
                annee: annee ? parseInt(annee) : null,
                ecole
            }
        });

        // Générer automatiquement les jetons de vote pour tous les étudiants éligibles
        await generateVoteTokensForElection(election);

        res.status(201).json({
            message: 'Élection créée avec succès',
            electionId: election.id
        });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Récupérer une élection spécifique avec ses candidats et statistiques
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(id) },
            include: {
                candidates: {
                    include: {
                        user: {
                            include: {
                                etudiant: true
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        votes: true,
                        voteTokens: true
                    }
                }
            }
        });

        if (!election) {
            return res.status(404).json({ message: 'Élection non trouvée' });
        }

        // Calculer les statistiques
        const totalVotes = election._count.votes;
        const totalTokens = election._count.voteTokens;
        const participationRate = totalTokens > 0 ? (totalVotes / totalTokens * 100).toFixed(2) : 0;

        const electionWithStats = {
            ...election,
            stats: {
                totalVotes,
                totalTokens,
                participationRate: `${participationRate}%`
            }
        };

        res.json(electionWithStats);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Clôturer une élection (admin seulement)
router.put('/:id/close', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const { id } = req.params;

        await prisma.election.update({
            where: { id: parseInt(id) },
            data: {
                isActive: false,
                dateFin: new Date()
            }
        });

        res.json({ message: 'Élection clôturée avec succès' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Supprimer une élection (admin seulement)
router.delete('/:id', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const { id } = req.params;

        // Supprimer en cascade (jetons, votes, candidats)
        await prisma.election.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Élection supprimée avec succès' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

/**
 * Génère automatiquement les jetons de vote pour tous les étudiants éligibles
 * @param {Object} election - L'élection pour laquelle générer les jetons
 */
async function generateVoteTokensForElection(election) {
    try {
        let eligibleStudents = [];

        if (election.type === 'SALLE') {
            // Élections par salle : étudiants de la même filière et année
            eligibleStudents = await prisma.etudiant.findMany({
                where: {
                    filiere: election.filiere,
                    annee: election.annee
                },
                include: { user: true }
            });
        } else if (election.type === 'ECOLE') {
            // Élections par école : responsables de salle de la même école
            // Ici on pourrait implémenter une logique plus complexe
            eligibleStudents = await prisma.etudiant.findMany({
                where: {
                    filiere: { contains: election.ecole }
                },
                include: { user: true }
            });
        } else if (election.type === 'UNIVERSITE') {
            // Élections universitaires : délégués d'école
            // Logique à implémenter selon la hiérarchie
            eligibleStudents = await prisma.etudiant.findMany({
                include: { user: true }
            });
        }

        console.log(`Génération de ${eligibleStudents.length} jetons pour l'élection ${election.titre}`);

        // Générer un jeton pour chaque étudiant éligible
        for (const student of eligibleStudents) {
            await VoteToken.createToken(student.userId, election.id);
        }

        console.log('Jetons de vote générés avec succès');
    } catch (error) {
        console.error('Erreur lors de la génération des jetons:', error);
    }
}

export default router;
