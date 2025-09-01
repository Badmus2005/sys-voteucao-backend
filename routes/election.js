import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import VoteToken from '../models/VoteToken.js';

const router = express.Router();

router.get('/active', async (req, res) => {
    try {
        const now = new Date();
        const activeElection = await prisma.election.findFirst({
            where: {
                dateFin: { gte: now },
                dateDebut: { lte: now }
            },
            orderBy: { dateDebut: 'asc' }
        });

        if (!activeElection) return res.status(204).send();
        res.json({ id: activeElection.id });
    } catch (error) {
        console.error('Erreur récupération élection active:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});


// Récupérer toutes les élections 
router.get('/', async (req, res) => {
    try {
        const { status } = req.query;

        let whereClause = {};

        if (status === 'active') {
            whereClause.isActive = true;
            whereClause.dateDebut = { lte: new Date() };
            whereClause.dateFin = { gte: new Date() };
        } else if (status === 'upcoming') {
            whereClause.isActive = true;
            whereClause.dateDebut = { gt: new Date() };
        } else if (status === 'closed') {
            whereClause.OR = [
                { isActive: false },
                { dateFin: { lt: new Date() } }
            ];
        }

        const elections = await prisma.election.findMany({
            where: whereClause,
            select: {
                id: true,
                type: true,
                titre: true,
                description: true,
                dateDebut: true,
                dateFin: true,
                dateDebutCandidature: true,
                dateFinCandidature: true,
                filiere: true,
                annee: true,
                ecole: true,
                niveau: true,
                delegueType: true,
                isActive: true,
                createdAt: true,
                candidates: {
                    select: {
                        id: true,
                        nom: true,
                        prenom: true,
                        slogan: true,
                        photoUrl: true,
                        statut: true
                    }
                },
                _count: {
                    select: {
                        votes: true,
                        candidates: true
                    }
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
        const { filiere, annee, ecole, page = 1, limit = 10, status = 'active' } = req.query;

        const validTypes = ['SALLE', 'ECOLE', 'UNIVERSITE'];
        if (!validTypes.includes(type.toUpperCase())) {
            return res.status(400).json({
                message: 'Type d\'élection invalide. Types valides: SALLE, ECOLE, UNIVERSITE'
            });
        }

        let whereClause = { type: type.toUpperCase() };

        if (status === 'active') {
            whereClause.isActive = true;
            whereClause.dateDebut = { lte: new Date() };
            whereClause.dateFin = { gte: new Date() };
        } else if (status === 'upcoming') {
            whereClause.isActive = true;
            whereClause.dateDebut = { gt: new Date() };
        } else if (status === 'closed') {
            whereClause.OR = [
                { isActive: false },
                { dateFin: { lt: new Date() } }
            ];
        }

        if (type.toUpperCase() === 'SALLE') {
            if (filiere) whereClause.filiere = filiere;
            if (annee) whereClause.annee = parseInt(annee);
        } else if (type.toUpperCase() === 'ECOLE') {
            if (ecole) whereClause.ecole = ecole;
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [elections, total] = await Promise.all([
            prisma.election.findMany({
                where: whereClause,
                select: {
                    id: true,
                    type: true,
                    titre: true,
                    description: true,
                    dateDebut: true,
                    dateFin: true,
                    dateDebutCandidature: true,
                    dateFinCandidature: true,
                    filiere: true,
                    annee: true,
                    ecole: true,
                    niveau: true,
                    delegueType: true,
                    isActive: true,
                    createdAt: true,
                    candidates: {
                        select: {
                            id: true,
                            nom: true,
                            prenom: true,
                            slogan: true,
                            photoUrl: true,
                            statut: true
                        }
                    },
                    _count: {
                        select: {
                            votes: true,
                            candidates: true,
                            voteTokens: true
                        }
                    }
                },
                orderBy: { dateDebut: 'desc' },
                skip,
                take
            }),
            prisma.election.count({ where: whereClause })
        ]);

        const electionsWithStats = elections.map(election => {
            const totalVotes = election._count.votes;
            const totalTokens = election._count.voteTokens;
            const participationRate = totalTokens > 0
                ? Math.round((totalVotes / totalTokens) * 100)
                : 0;

            return {
                ...election,
                stats: {
                    totalVotes,
                    totalTokens,
                    participationRate: `${participationRate}%`,
                    candidatesCount: election._count.candidates
                }
            };
        });

        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            elections: electionsWithStats,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalElections: total,
                hasNext: parseInt(page) < totalPages,
                hasPrev: parseInt(page) > 1
            },
            filters: { type, filiere, annee, ecole, status }
        });

    } catch (error) {
        console.error('Error fetching elections by type:', error);
        res.status(500).json({
            message: 'Erreur serveur lors de la récupération des élections',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// Récupérer une élection spécifique
router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(id) },
            select: {
                id: true,
                type: true,
                titre: true,
                description: true,
                dateDebut: true,
                dateFin: true,
                dateDebutCandidature: true,
                dateFinCandidature: true,
                filiere: true,
                annee: true,
                ecole: true,
                niveau: true,
                delegueType: true,
                isActive: true,
                createdAt: true,
                candidates: {
                    select: {
                        id: true,
                        nom: true,
                        prenom: true,
                        slogan: true,
                        programme: true,
                        motivation: true,
                        photoUrl: true,
                        statut: true,
                        userId: true,
                        createdAt: true
                    }
                },
                _count: {
                    select: {
                        votes: true,
                        voteTokens: true,
                        candidates: true
                    }
                }
            }
        });

        if (!election) {
            return res.status(404).json({ message: 'Élection non trouvée' });
        }

        const totalVotes = election._count.votes;
        const totalTokens = election._count.voteTokens;
        const participationRate = totalTokens > 0 ? (totalVotes / totalTokens * 100).toFixed(2) : 0;

        const electionWithStats = {
            ...election,
            stats: {
                totalVotes,
                totalTokens,
                participationRate: `${participationRate}%`,
                totalCandidates: election._count.candidates
            }
        };

        res.json(electionWithStats);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

router.get("/my-elections", authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { etudiant: true },
        });

        if (!user || !user.etudiant) {
            return res.status(404).json([]);
        }

        const { filiere, annee, ecole } = user.etudiant;

        const elections = await prisma.election.findMany({
            where: {
                isActive: true,
                OR: [
                    { type: "UNIVERSITE" },
                    {
                        AND: [{ type: "ECOLE" }, { ecole: ecole }],
                    },
                    {
                        AND: [
                            { type: "SALLE" },
                            { filiere: filiere },
                            { annee: annee },
                            { ecole: ecole },
                        ],
                    },
                ],
            },
            orderBy: {
                createdAt: "desc",
            },
            include: {
                candidates: true,
            },
        });

        return res.json(elections); // 👉 Toujours un tableau JSON
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: "Erreur serveur" });
    }
});


// FONCTION: Vérifier l'éligibilité (version robuste)
function isEligibleForElection(etudiant, election) {
    if (!etudiant || !election) return false;

    // Convertir en string pour éviter les problèmes de type
    const etudiantFiliere = String(etudiant.filiere || '');
    const etudiantAnnee = String(etudiant.annee || '');
    const etudiantEcole = String(etudiant.ecole || '');
    const electionFiliere = String(election.filiere || '');
    const electionAnnee = String(election.annee || '');
    const electionEcole = String(election.ecole || '');

    if (election.type === 'SALLE') {
        return etudiantFiliere === electionFiliere &&
            etudiantAnnee === electionAnnee &&
            etudiantEcole === electionEcole;
    } else if (election.type === 'ECOLE') {
        return etudiantEcole === electionEcole;
    } else if (election.type === 'UNIVERSITE') {
        return true;
    }
    return false;
}

// Backend: créer cet endpoint
/*router.get('/election/:id/check-eligibility', authenticateToken, async (req, res) => {
    try {
        const election = await election.findById(req.params.id);
        const user = req.user;

        // Logique d'éligibilité
        const isEligible = isEligibleForElection(user, election);

        res.json({ eligible: isEligible, reason: isEligible ? '' : 'Non éligible' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});*/

// Route pour récupérer les détails complets des candidats d'une élection
router.get('/:id/candidates-details', async (req, res) => {
    try {
        const { id } = req.params;

        const candidates = await prisma.candidate.findMany({
            where: { electionId: parseInt(id) },
            include: {
                user: {
                    include: {
                        etudiant: {
                            select: {
                                matricule: true,
                                filiere: true,
                                annee: true,
                                ecole: true
                            }
                        }
                    }
                }
            }
        });

        res.json(candidates);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Créer une nouvelle élection (admin seulement)
router.post('/', authenticateToken, async (req, res) => {
    try {
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const {
            type,
            titre,
            description,
            dateDebut,
            dateFin,
            dateDebutCandidature,
            dateFinCandidature,
            filiere,
            annee,
            ecole,
            niveau,
            delegueType
        } = req.body;

        // VALIDATION DES DATES
        const now = new Date();
        const debutCandidature = new Date(dateDebutCandidature);
        const finCandidature = new Date(dateFinCandidature);
        const debutVote = new Date(dateDebut);
        const finVote = new Date(dateFin);

        // Validation: dates de candidature doivent être avant le vote
        if (finCandidature >= debutVote) {
            return res.status(400).json({
                message: 'La fin des candidatures doit être avant le début du vote'
            });
        }

        // Validation: dates de candidature cohérentes
        if (debutCandidature >= finCandidature) {
            return res.status(400).json({
                message: 'La date de début des candidatures doit être avant la date de fin'
            });
        }

        // Validation: dates de vote cohérentes
        if (debutVote >= finVote) {
            return res.status(400).json({
                message: 'La date de début du vote doit être avant la date de fin'
            });
        }

        // Validation: les dates ne doivent pas être dans le passé
        if (debutCandidature < now) {
            return res.status(400).json({
                message: 'La date de début des candidatures ne peut pas être dans le passé'
            });
        }

        // Validations spécifiques au type d'élection
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

        // Conversion du niveau si nécessaire
        let niveauPrisma = null;
        if (niveau) {
            niveauPrisma = niveau.toUpperCase();
            if (!['PHASE1', 'PHASE2', 'PHASE3'].includes(niveauPrisma)) {
                return res.status(400).json({
                    message: 'Niveau d\'élection invalide. Valeurs valides: PHASE1, PHASE2, PHASE3'
                });
            }
        }

        // Conversion du delegueType si nécessaire
        let delegueTypePrisma = null;
        if (delegueType) {
            delegueTypePrisma = delegueType.toUpperCase();
            if (!['PREMIER', 'DEUXIEME'].includes(delegueTypePrisma)) {
                return res.status(400).json({
                    message: 'Type de délégué invalide. Valeurs valides: PREMIER, DEUXIEME'
                });
            }
        }

        // Création de l'élection
        const election = await prisma.election.create({
            data: {
                type: type.toUpperCase(),
                titre,
                description,
                dateDebut: debutVote,
                dateFin: finVote,
                dateDebutCandidature: debutCandidature,
                dateFinCandidature: finCandidature,
                filiere,
                annee: annee ? parseInt(annee) : null,
                ecole,
                niveau: niveauPrisma,
                delegueType: delegueTypePrisma
            }
        });

        await generateVoteTokensForElection(election);

        res.status(201).json({
            message: 'Élection créée avec succès',
            electionId: election.id,
            election: election
        });
    } catch (error) {
        console.error('Erreur création élection:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Clôturer une élection (admin seulement)
router.put('/:id/close', authenticateToken, async (req, res) => {
    try {
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
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const { id } = req.params;

        // Supprimer les votes associés
        await prisma.vote.deleteMany({
            where: { electionId: parseInt(id) }
        });

        // Supprimer les candidats associés
        await prisma.candidate.deleteMany({
            where: { electionId: parseInt(id) }
        });

        // Supprimer les jetons de vote associés
        await prisma.voteToken.deleteMany({
            where: { electionId: parseInt(id) }
        });

        // Supprimer l'élection
        await prisma.election.delete({
            where: { id: parseInt(id) }
        });

        res.json({ message: 'Élection supprimée avec succès' });
    } catch (error) {
        console.error('Erreur suppression élection:', error);
        res.status(500).json({ message: error.message || 'Erreur serveur' });
    }
});

// Statistiques par type d'élection
router.get('/stats/by-type/:type', async (req, res) => {
    try {
        const { type } = req.params;
        const { filiere, annee, ecole } = req.query;

        const validTypes = ['SALLE', 'ECOLE', 'UNIVERSITE'];
        if (!validTypes.includes(type.toUpperCase())) {
            return res.status(400).json({ message: 'Type d\'élection invalide' });
        }

        const whereClause = {
            type: type.toUpperCase(),
            ...(type.toUpperCase() === 'SALLE' && {
                ...(filiere && { filiere }),
                ...(annee && { annee: parseInt(annee) })
            }),
            ...(type.toUpperCase() === 'ECOLE' && {
                ...(ecole && { ecole })
            })
        };

        const [
            totalElections,
            activeElections,
            upcomingElections,
            closedElections,
            totalVotes,
            totalCandidates
        ] = await Promise.all([
            prisma.election.count({ where: whereClause }),
            prisma.election.count({
                where: {
                    ...whereClause,
                    isActive: true,
                    dateDebut: { lte: new Date() },
                    dateFin: { gte: new Date() }
                }
            }),
            prisma.election.count({
                where: {
                    ...whereClause,
                    isActive: true,
                    dateDebut: { gt: new Date() }
                }
            }),
            prisma.election.count({
                where: {
                    ...whereClause,
                    OR: [
                        { isActive: false },
                        { dateFin: { lt: new Date() } }
                    ]
                }
            }),
            prisma.vote.count({
                where: {
                    election: whereClause
                }
            }),
            prisma.candidate.count({
                where: {
                    election: whereClause
                }
            })
        ]);

        res.json({
            type: type.toUpperCase(),
            statistics: {
                totalElections,
                activeElections,
                upcomingElections,
                closedElections,
                totalVotes,
                totalCandidates,
                averageCandidatesPerElection: totalElections > 0
                    ? (totalCandidates / totalElections).toFixed(1)
                    : 0,
                averageVotesPerElection: totalElections > 0
                    ? (totalVotes / totalElections).toFixed(1)
                    : 0
            },
            filters: { filiere, annee, ecole },
            lastUpdated: new Date().toISOString()
        });

    } catch (error) {
        console.error('Error fetching election stats by type:', error);
        res.status(500).json({
            message: 'Erreur serveur lors de la récupération des statistiques',
            error: process.env.NODE_ENV === 'development' ? error.message : undefined
        });
    }
});

// FONCTION: Générer les jetons pour une élection
async function generateVoteTokensForElection(election) {
    try {
        let eligibleStudents = [];

        if (election.type === 'SALLE') {
            // Pour les élections de salle, tous les étudiants de la filière et année
            eligibleStudents = await prisma.etudiant.findMany({
                where: {
                    filiere: election.filiere,
                    annee: election.annee
                },
                include: { user: true }
            });
        } else if (election.type === 'ECOLE') {
            // Pour les élections d'école, les responsables de salle de cette école
            const responsables = await prisma.responsableSalle.findMany({
                where: { ecole: election.ecole },
                include: {
                    etudiant: {
                        include: { user: true }
                    }
                }
            });
            eligibleStudents = responsables.map(r => r.etudiant);
        } else if (election.type === 'UNIVERSITE') {
            // Pour les élections universitaires, les délégués d'école
            const deleguesEcole = await prisma.delegueEcole.findMany({
                include: {
                    responsable: {
                        include: {
                            etudiant: {
                                include: { user: true }
                            }
                        }
                    }
                }
            });
            eligibleStudents = deleguesEcole.map(d => d.responsable.etudiant);
        }

        console.log(`Génération de ${eligibleStudents.length} jetons pour l'élection ${election.titre}`);

        // Générer les jetons de vote pour chaque étudiant éligible
        for (const student of eligibleStudents) {
            if (student.userId) {
                await VoteToken.createToken(student.userId, election.id);
            }
        }

        console.log('Jetons de vote générés avec succès');
    } catch (error) {
        console.error('Erreur lors de la génération des jetons:', error);
        throw error;
    }
}

export default router;