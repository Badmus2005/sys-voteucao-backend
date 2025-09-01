import express from 'express';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();


// Récupérer tous les candidats d'une élection spécifique
router.get('/election/:electionId', authenticateToken, async (req, res) => {
    try {
        const { electionId } = req.params;

        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) }
        });

        if (!election) {
            return res.status(404).json({
                message: 'Élection non trouvée'
            });
        }

        const candidates = await prisma.candidate.findMany({
            where: {
                electionId: parseInt(electionId),
                statut: 'APPROUVE' // Seulement les candidats approuvés
            },
            include: {
                user: {
                    include: {
                        etudiant: {
                            select: {
                                nom: true,
                                prenom: true,
                                filiere: true,
                                annee: true,
                                ecole: true,
                                photoUrl: true
                            }
                        }
                    }
                },
                election: {
                    select: {
                        titre: true,
                        type: true
                    }
                },
                _count: {
                    select: {
                        votes: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        const formattedCandidates = candidates.map(candidate => ({
            id: candidate.id,
            nom: candidate.nom,
            prenom: candidate.prenom,
            slogan: candidate.slogan,
            programme: candidate.programme,
            motivation: candidate.motivation,
            photoUrl: candidate.photoUrl,
            statut: candidate.statut,
            createdAt: candidate.createdAt,
            userDetails: candidate.user.etudiant ? {
                filiere: candidate.user.etudiant.filiere,
                annee: candidate.user.etudiant.annee,
                ecole: candidate.user.etudiant.ecole,
                photoUrl: candidate.user.etudiant.photoUrl
            } : null,
            electionDetails: {
                titre: candidate.election.titre,
                type: candidate.election.type
            },
            votesCount: candidate._count.votes
        }));

        res.json({
            success: true,
            election: {
                id: election.id,
                titre: election.titre,
                type: election.type
            },
            candidates: formattedCandidates,
            totalCandidates: candidates.length
        });

    } catch (error) {
        console.error('Erreur récupération candidats:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des candidats'
        });
    }
});

// Vérifier si l'utilisateur est déjà candidat à une élection (avec détails)
router.get('/is-candidate/:electionId', authenticateToken, async (req, res) => {
    try {
        const { electionId } = req.params;

        // Vérifier que l'élection existe
        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) }
        });

        if (!election) {
            return res.status(404).json({
                message: 'Élection non trouvée',
                isCandidate: false
            });
        }

        // Vérifier si l'utilisateur est déjà candidat pour cette élection
        const existingCandidate = await prisma.candidate.findFirst({
            where: {
                userId: req.user.id,
                electionId: parseInt(electionId)
            },
            include: {
                election: {
                    select: {
                        titre: true,
                        type: true
                    }
                }
            }
        });

        if (existingCandidate) {
            res.json({
                isCandidate: true,
                candidate: {
                    id: existingCandidate.id,
                    nom: existingCandidate.nom,
                    prenom: existingCandidate.prenom,
                    program: existingCandidate.program,
                    photoUrl: existingCandidate.photoUrl,
                    createdAt: existingCandidate.createdAt
                },
                election: {
                    id: existingCandidate.election.id,
                    titre: existingCandidate.election.titre,
                    type: existingCandidate.election.type
                }
            });
        } else {
            res.json({
                isCandidate: false,
                message: 'Vous n\'êtes pas candidat à cette élection'
            });
        }

    } catch (error) {
        console.error('Erreur vérification candidature:', error);
        res.status(500).json({
            message: 'Erreur serveur',
            isCandidate: false
        });
    }
});

// GET /api/candidats/mes-candidatures - Récupérer les candidatures de l'étudiant connecté
router.get('/mes-candidatures', authenticateToken, async (req, res) => {
    try {
        const userId = req.user.id;

        // Récupérer les candidatures de l'utilisateur
        const candidatures = await prisma.candidate.findMany({
            where: {
                userId: userId
            },
            include: {
                election: {
                    select: {
                        id: true,
                        titre: true,
                        type: true,
                        description: true,
                        dateDebut: true,
                        dateFin: true
                    }
                },
                _count: {
                    select: {
                        votes: true
                    }
                }
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        // Formater la réponse
        const formattedCandidatures = candidatures.map(candidature => ({
            id: candidature.id,
            nom: candidature.nom,
            prenom: candidature.prenom,
            slogan: candidature.slogan,
            programme: candidature.programme,
            motivation: candidature.motivation,
            photoUrl: candidature.photoUrl,
            statut: candidature.statut,
            createdAt: candidature.createdAt,
            updatedAt: candidature.updatedAt,
            election: candidature.election,
            votesCount: candidature._count.votes
        }));

        res.json({
            success: true,
            candidatures: formattedCandidatures,
            total: candidatures.length
        });

    } catch (error) {
        console.error('Erreur récupération candidatures:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des candidatures'
        });
    }
});

// GET /api/candidats/:id - Récupérer un candidat spécifique
router.get('/:id', async (req, res) => {
    try {
        const candidateId = parseInt(req.params.id);

        if (isNaN(candidateId)) {
            return res.status(400).json({ message: 'ID de candidat invalide' });
        }

        const candidate = await prisma.candidate.findUnique({
            where: { id: candidateId },
            include: {
                user: {
                    include: {
                        etudiant: true
                    }
                },
                election: true,
                _count: {
                    select: {
                        votes: true
                    }
                }
            }
        });

        if (!candidate) {
            return res.status(404).json({ message: 'Candidat non trouvé' });
        }

        res.json(candidate);

    } catch (error) {
        console.error('Error fetching candidate:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// Déposer une candidature à une élection 
router.post('/', authenticateToken, async (req, res) => {
    try {
        const { electionId, slogan, photo, programme, motivation } = req.body;
        const userId = req.user.id;

        console.log('=== DÉBUT CANDIDATURE ===');
        console.log('User ID:', userId);
        console.log('Election ID:', electionId);

        // Validation des champs requis
        if (!userId || !electionId || !slogan || !photo || !programme || !motivation) {
            return res.status(400).json({
                success: false,
                message: 'Tous les champs sont requis: electionId, slogan, photo, programme, motivation'
            });
        }

        // Vérifier que l'utilisateur existe
        const user = await prisma.user.findUnique({
            where: { id: userId },
            include: { etudiant: true }
        });

        if (!user) {
            return res.status(400).json({
                success: false,
                message: 'Utilisateur inexistant'
            });
        }

        // Vérifier que l'élection existe
        const election = await prisma.election.findUnique({
            where: { id: parseInt(electionId) }
        });

        if (!election) {
            return res.status(400).json({
                success: false,
                message: 'Élection inexistante'
            });
        }

        // Vérifier que l'utilisateur n'est pas déjà candidat à cette élection
        const existingCandidate = await prisma.candidate.findFirst({
            where: { userId, electionId: parseInt(electionId) }
        });

        if (existingCandidate) {
            return res.status(400).json({
                success: false,
                message: 'Vous êtes déjà candidat à cette élection.'
            });
        }

        // RÉSOLUTION DU PROBLÈME : Validation des champs nom et prenom
        let nom = user.etudiant?.nom;
        let prenom = user.etudiant?.prenom;

        // Si les champs sont manquants dans etudiant, utilisez des valeurs par défaut valides
        if (!nom || nom.trim().length === 0) {
            nom = 'Candidat';
            console.log('⚠️ Nom manquant, utilisation de valeur par défaut');
        }

        if (!prenom || prenom.trim().length === 0) {
            prenom = 'Étudiant';
            console.log('⚠️ Prénom manquant, utilisation de valeur par défaut');
        }

        // Valider les longueurs maximales
        if (nom.length > 100) {
            nom = nom.substring(0, 100);
            console.log('⚠️ Nom tronqué à 100 caractères');
        }

        if (prenom.length > 100) {
            prenom = prenom.substring(0, 100);
            console.log('⚠️ Prénom tronqué à 100 caractères');
        }

        if (slogan.length > 200) {
            return res.status(400).json({
                success: false,
                message: 'Le slogan ne doit pas dépasser 200 caractères'
            });
        }

        if (photo.length > 500) {
            return res.status(400).json({
                success: false,
                message: 'L\'URL de la photo est trop longue'
            });
        }

        console.log('📝 Données finales:', { nom, prenom, slogan: slogan.length, photo: photo.length });

        // Créer la candidature
        const candidate = await prisma.candidate.create({
            data: {
                nom,
                prenom,
                slogan,
                programme,
                motivation,
                photoUrl: photo,
                userId,
                electionId: parseInt(electionId),
                statut: 'EN_ATTENTE'
            }
        });

        console.log('✅ Candidature créée avec succès:', candidate.id);

        res.status(201).json({
            success: true,
            message: 'Candidature déposée avec succès',
            candidate
        });

    } catch (error) {
        console.error('❌ Erreur création candidature:', error);

        // Log détaillé pour Prisma
        if (error.code === 'P2002') {
            console.error('❌ Violation de contrainte unique');
        }
        if (error.meta) {
            console.error('❌ Meta erreur:', error.meta);
        }

        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la création de la candidature',
            error: process.env.NODE_ENV === 'development' ? {
                message: error.message,
                code: error.code,
                meta: error.meta
            } : undefined
        });
    }
});



router.put('/candidats/:id', authenticateToken, async (req, res) => {
    // Logique de modification
});

router.delete('/candidats/:id', authenticateToken, async (req, res) => {
    // Logique de suppression
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


// GET /api/candidats - Liste des candidats 
router.get('/', async (req, res) => {
    try {
        const { electionId, page = 1, limit = 10 } = req.query;

        // Construction de la clause WHERE
        const whereClause = {};
        if (electionId) {
            whereClause.electionId = parseInt(electionId);
        }

        // Pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [candidates, total] = await Promise.all([
            prisma.candidate.findMany({
                where: whereClause,
                include: {
                    user: {
                        include: {
                            etudiant: true
                        }
                    },
                    election: true,
                    _count: {
                        select: {
                            votes: true
                        }
                    }
                },
                orderBy: {
                    nom: 'asc'
                },
                skip,
                take
            }),
            prisma.candidate.count({ where: whereClause })
        ]);

        const totalPages = Math.ceil(total / parseInt(limit));

        res.json({
            candidates,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalCandidates: total,
                hasNext: parseInt(page) < totalPages,
                hasPrev: parseInt(page) > 1
            }
        });

    } catch (error) {
        console.error('Error fetching candidates:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// PUT /api/candidats/:id - Modifier un candidat (Admin seulement)
router.put('/:id', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const candidateId = parseInt(req.params.id);
        const { nom, prenom, programme, photoUrl } = req.body;

        if (isNaN(candidateId)) {
            return res.status(400).json({ message: 'ID de candidat invalide' });
        }

        const candidate = await prisma.candidate.update({
            where: { id: candidateId },
            data: {
                ...(nom && { nom }),
                ...(prenom && { prenom }),
                ...(programme !== undefined && { programme }),
                ...(photoUrl !== undefined && { photoUrl })
            },
            include: {
                user: {
                    include: {
                        etudiant: true
                    }
                },
                election: true
            }
        });

        res.json({ message: 'Candidat mis à jour avec succès', candidate });

    } catch (error) {
        console.error('Error updating candidate:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});

// DELETE /api/candidats/:id - Supprimer un candidat (Admin seulement)
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

        const candidateId = parseInt(req.params.id);

        if (isNaN(candidateId)) {
            return res.status(400).json({ message: 'ID de candidat invalide' });
        }

        await prisma.candidate.delete({
            where: { id: candidateId }
        });

        res.json({ message: 'Candidat supprimé avec succès' });

    } catch (error) {
        console.error('Error deleting candidate:', error);
        res.status(500).json({ message: 'Erreur serveur' });
    }
});


// GET /api/candidats/admin/list - Liste des candidats pour l'admin avec filtres
router.get('/admin/list', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const {
            electionId,
            statut,
            search,
            page = 1,
            limit = 10
        } = req.query;

        // Construction de la clause WHERE
        const whereClause = {};

        if (electionId && electionId !== 'all') {
            whereClause.electionId = parseInt(electionId);
        }

        if (statut && statut !== 'all') {
            whereClause.statut = statut;
        }

        if (search) {
            whereClause.OR = [
                { nom: { contains: search, mode: 'insensitive' } },
                { prenom: { contains: search, mode: 'insensitive' } },
                {
                    user: {
                        email: { contains: search, mode: 'insensitive' },
                        etudiant: {
                            OR: [
                                { matricule: { contains: search, mode: 'insensitive' } },
                                { filiere: { contains: search, mode: 'insensitive' } }
                            ]
                        }
                    }
                },
                { election: { titre: { contains: search, mode: 'insensitive' } } }
            ];
        }

        // Pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);
        const take = parseInt(limit);

        const [candidates, total] = await Promise.all([
            prisma.candidate.findMany({
                where: whereClause,
                include: {
                    user: {
                        include: {
                            etudiant: {
                                select: {
                                    id: true,
                                    matricule: true,
                                    filiere: true,
                                    annee: true,
                                    ecole: true,
                                    photoUrl: true
                                }
                            }
                        }
                    },
                    election: {
                        select: {
                            id: true,
                            titre: true,
                            type: true,
                            dateDebut: true,
                            dateFin: true
                        }
                    },
                    _count: {
                        select: {
                            votes: true
                        }
                    }
                },
                orderBy: {
                    createdAt: 'desc'
                },
                skip,
                take
            }),
            prisma.candidate.count({ where: whereClause })
        ]);

        const totalPages = Math.ceil(total / parseInt(limit));

        // Formater la réponse
        const formattedCandidates = candidates.map(candidate => ({
            id: candidate.id,
            nom: candidate.nom,
            prenom: candidate.prenom,
            slogan: candidate.slogan,
            programme: candidate.programme,
            motivation: candidate.motivation,
            photoUrl: candidate.photoUrl,
            statut: candidate.statut,
            createdAt: candidate.createdAt,
            updatedAt: candidate.updatedAt,
            user: {
                id: candidate.user.id,
                email: candidate.user.email,
                etudiant: candidate.user.etudiant ? {
                    id: candidate.user.etudiant.id,
                    matricule: candidate.user.etudiant.matricule,
                    filiere: candidate.user.etudiant.filiere,
                    annee: candidate.user.etudiant.annee,
                    ecole: candidate.user.etudiant.ecole,
                    photoUrl: candidate.user.etudiant.photoUrl
                } : null
            },
            election: {
                id: candidate.election.id,
                titre: candidate.election.titre,
                type: candidate.election.type,
                dateDebut: candidate.election.dateDebut,
                dateFin: candidate.election.dateFin
            },
            votesCount: candidate._count.votes
        }));

        res.json({
            success: true,
            candidates: formattedCandidates,
            pagination: {
                currentPage: parseInt(page),
                totalPages,
                totalCandidates: total,
                hasNext: parseInt(page) < totalPages,
                hasPrev: parseInt(page) > 1
            }
        });

    } catch (error) {
        console.error('Erreur récupération candidats admin:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des candidats'
        });
    }
});

// GET /api/candidats/admin/stats - Statistiques pour l'admin
router.get('/admin/stats', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const [total, enAttente, approuves, rejetes] = await Promise.all([
            prisma.candidate.count(),
            prisma.candidate.count({ where: { statut: 'EN_ATTENTE' } }),
            prisma.candidate.count({ where: { statut: 'APPROUVE' } }),
            prisma.candidate.count({ where: { statut: 'REJETE' } })
        ]);

        res.json({
            success: true,
            stats: {
                total,
                enAttente,
                approuves,
                rejetes
            }
        });

    } catch (error) {
        console.error('Erreur récupération stats:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des statistiques'
        });
    }
});

// PATCH /api/candidats/:id/status - Mettre à jour le statut d'un candidat (Admin seulement)
router.patch('/:id/status', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const candidateId = parseInt(req.params.id);
        const { statut } = req.body;

        if (isNaN(candidateId)) {
            return res.status(400).json({
                success: false,
                message: 'ID de candidat invalide'
            });
        }

        if (!statut || !['EN_ATTENTE', 'APPROUVE', 'REJETE'].includes(statut)) {
            return res.status(400).json({
                success: false,
                message: 'Statut invalide. Valeurs acceptées: EN_ATTENTE, APPROUVE, REJETE'
            });
        }

        // Vérifier que le candidat existe
        const candidate = await prisma.candidate.findUnique({
            where: { id: candidateId },
            include: {
                user: {
                    include: {
                        etudiant: true
                    }
                },
                election: true
            }
        });

        if (!candidate) {
            return res.status(404).json({
                success: false,
                message: 'Candidat non trouvé'
            });
        }

        // Mettre à jour le statut
        const updatedCandidate = await prisma.candidate.update({
            where: { id: candidateId },
            data: { statut },
            include: {
                user: {
                    include: {
                        etudiant: {
                            select: {
                                nom: true,
                                prenom: true,
                                matricule: true,
                                filiere: true,
                                annee: true,
                                ecole: true
                            }
                        }
                    }
                },
                election: {
                    select: {
                        titre: true,
                        type: true
                    }
                }
            }
        });

        // TODO: Envoyer une notification à l'étudiant
        console.log(`Statut candidature mis à jour: ${candidateId} -> ${statut}`);

        res.json({
            success: true,
            message: `Statut de la candidature mis à jour avec succès`,
            candidate: {
                id: updatedCandidate.id,
                nom: updatedCandidate.nom,
                prenom: updatedCandidate.prenom,
                statut: updatedCandidate.statut,
                user: {
                    email: updatedCandidate.user.email,
                    etudiant: updatedCandidate.user.etudiant
                },
                election: updatedCandidate.election
            }
        });

    } catch (error) {
        console.error('Erreur mise à jour statut:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la mise à jour du statut'
        });
    }
});

// GET /api/candidats/admin/:id - Récupérer un candidat avec tous les détails pour l'admin
router.get('/admin/:id', authenticateToken, async (req, res) => {
    try {
        // Vérifier que l'utilisateur est admin
        const user = await prisma.user.findUnique({
            where: { id: req.user.id },
            include: { admin: true }
        });

        if (!user || user.role !== 'ADMIN') {
            return res.status(403).json({ message: 'Accès refusé' });
        }

        const candidateId = parseInt(req.params.id);

        if (isNaN(candidateId)) {
            return res.status(400).json({ message: 'ID de candidat invalide' });
        }

        const candidate = await prisma.candidate.findUnique({
            where: { id: candidateId },
            include: {
                user: {
                    include: {
                        etudiant: {
                            include: {
                                user: {
                                    select: {
                                        email: true,
                                        createdAt: true
                                    }
                                }
                            }
                        }
                    }
                },
                election: {
                    select: {
                        id: true,
                        titre: true,
                        type: true,
                        description: true,
                        dateDebut: true,
                        dateFin: true,
                        dateDebutCandidature: true,
                        dateFinCandidature: true
                    }
                },
                votes: {
                    include: {
                        user: {
                            include: {
                                etudiant: {
                                    select: {
                                        matricule: true,
                                        filiere: true,
                                        annee: true
                                    }
                                }
                            }
                        }
                    },
                    orderBy: {
                        createdAt: 'desc'
                    },
                    take: 10 // Derniers 10 votes
                },
                _count: {
                    select: {
                        votes: true
                    }
                }
            }
        });

        if (!candidate) {
            return res.status(404).json({
                success: false,
                message: 'Candidat non trouvé'
            });
        }

        // Formater la réponse
        const formattedCandidate = {
            id: candidate.id,
            nom: candidate.nom,
            prenom: candidate.prenom,
            slogan: candidate.slogan,
            programme: candidate.programme,
            motivation: candidate.motivation,
            photoUrl: candidate.photoUrl,
            statut: candidate.statut,
            createdAt: candidate.createdAt,
            updatedAt: candidate.updatedAt,
            user: {
                id: candidate.user.id,
                email: candidate.user.email,
                createdAt: candidate.user.createdAt,
                etudiant: candidate.user.etudiant ? {
                    id: candidate.user.etudiant.id,
                    matricule: candidate.user.etudiant.matricule,
                    nom: candidate.user.etudiant.nom,
                    prenom: candidate.user.etudiant.prenom,
                    filiere: candidate.user.etudiant.filiere,
                    annee: candidate.user.etudiant.annee,
                    ecole: candidate.user.etudiant.ecole,
                    photoUrl: candidate.user.etudiant.photoUrl
                } : null
            },
            election: candidate.election,
            votes: candidate.votes.map(vote => ({
                id: vote.id,
                createdAt: vote.createdAt,
                user: {
                    email: vote.user.email,
                    etudiant: vote.user.etudiant ? {
                        matricule: vote.user.etudiant.matricule,
                        filiere: vote.user.etudiant.filiere,
                        annee: vote.user.etudiant.annee
                    } : null
                }
            })),
            votesCount: candidate._count.votes
        };

        res.json({
            success: true,
            candidate: formattedCandidate
        });

    } catch (error) {
        console.error('Erreur récupération détails candidat:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur serveur lors de la récupération des détails du candidat'
        });
    }
});


export default router;
