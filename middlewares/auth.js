import jwt from 'jsonwebtoken';
import prisma from '../prisma.js';

/**
 * Middleware d'authentification JWT
 */
export const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({
                message: 'Token d\'authentification requis'
            });
        }

        // Vérification du token
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        // Récupération de l'utilisateur avec ses relations
        const user = await prisma.user.findUnique({
            where: { id: decoded.id },
            include: {
                etudiant: true,
                admin: true
            }
        });

        if (!user) {
            return res.status(401).json({
                message: 'Utilisateur non trouvé'
            });
        }

        // Ajout des informations utilisateur à la requête
        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            requirePasswordChange: user.requirePasswordChange,
            etudiant: user.etudiant,
            admin: user.admin
        };

        next();
    } catch (error) {
        console.error('Erreur d\'authentification:', error);
        return res.status(401).json({
            message: 'Token invalide ou expiré'
        });
    }
};


/**
 * Middleware de vérification de rôle
 */
export const requireRole = (roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({
                message: 'Authentification requise'
            });
        }

        const userRole = req.user.role;
        const allowedRoles = Array.isArray(roles) ? roles : [roles];

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                message: 'Permissions insuffisantes'
            });
        }

        next();
    };
};

/**
 * Middleware pour vérifier si l'utilisateur est un étudiant
 */
export const requireStudent = requireRole('ETUDIANT');

/**
 * Middleware pour vérifier si l'utilisateur est un admin
 */
export const requireAdmin = requireRole('ADMIN');

/**
 * Middleware pour vérifier si l'utilisateur peut voter
 */
export const canVote = async (req, res, next) => {
    try {
        if (!req.user || req.user.role !== 'ETUDIANT') {
            return res.status(403).json({
                message: 'Seuls les étudiants peuvent voter',
                code: 'STUDENT_ONLY'
            });
        }

        // Vérifier si l'étudiant a un profil complet
        if (!req.user.etudiant || !req.user.etudiant.matricule) {
            return res.status(400).json({
                message: 'Profil étudiant incomplet',
                code: 'INCOMPLETE_PROFILE'
            });
        }

        next();
    } catch (error) {
        console.error('Erreur vérification vote:', error);
        return res.status(500).json({
            message: 'Erreur lors de la vérification',
            code: 'VOTE_CHECK_ERROR'
        });
    }
};

/**
 * Middleware pour vérifier la propriété de la ressource
 */
export const checkOwnership = (resourceType) => {
    return async (req, res, next) => {
        try {
            const resourceId = parseInt(req.params.id);
            const userId = req.user.id;

            let resource;

            switch (resourceType) {
                case 'election':
                    resource = await prisma.election.findUnique({
                        where: { id: resourceId },
                        include: { candidates: true }
                    });
                    break;
                case 'candidate':
                    resource = await prisma.candidate.findUnique({
                        where: { id: resourceId }
                    });
                    break;
                case 'vote':
                    resource = await prisma.vote.findUnique({
                        where: { id: resourceId }
                    });
                    break;
                default:
                    return res.status(400).json({
                        message: 'Type de ressource non supporté',
                        code: 'UNSUPPORTED_RESOURCE'
                    });
            }

            if (!resource) {
                return res.status(404).json({
                    message: 'Ressource non trouvée',
                    code: 'RESOURCE_NOT_FOUND'
                });
            }

            // Les admins peuvent accéder à toutes les ressources
            if (req.user.role === 'ADMIN') {
                req.resource = resource;
                return next();
            }

            // Vérifier la propriété selon le type
            let isOwner = false;

            switch (resourceType) {
                case 'election':
                    // Les étudiants ne peuvent pas modifier les élections
                    isOwner = false;
                    break;
                case 'candidate':
                    isOwner = resource.userId === userId;
                    break;
                case 'vote':
                    isOwner = resource.userId === userId;
                    break;
            }

            if (!isOwner) {
                return res.status(403).json({
                    message: 'Accès non autorisé à cette ressource',
                    code: 'RESOURCE_ACCESS_DENIED'
                });
            }

            req.resource = resource;
            next();
        } catch (error) {
            console.error('Erreur vérification propriété:', error);
            return res.status(500).json({
                message: 'Erreur lors de la vérification',
                code: 'OWNERSHIP_CHECK_ERROR'
            });
        }
    };
};

// Middleware pour vérifier si le changement de mot de passe est requis
export const checkPasswordChange = (req, res, next) => {
    if (req.user.requirePasswordChange && req.path !== '/change-password') {
        return res.status(403).json({
            message: 'Vous devez changer votre mot de passe avant de continuer',
            code: 'PASSWORD_CHANGE_REQUIRED',
            requirePasswordChange: true
        });
    }
    next();
};
