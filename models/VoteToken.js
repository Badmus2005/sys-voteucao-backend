import prisma from '../prisma.js';
import crypto from 'crypto';


/**
 * Modèle pour gérer les jetons de vote uniques
 * Chaque étudiant reçoit un jeton unique pour chaque élection
 */
class VoteToken {

    /**
     * Génère un jeton de vote unique
     * @returns {string} Jeton unique
     */
    static generateToken() {
        return crypto.randomBytes(32).toString('hex');
    }

    /**
     * Crée un jeton de vote pour un étudiant et une élection
     * @param {number} userId - ID de l'utilisateur
     * @param {number} electionId - ID de l'élection
     * @returns {Object} Jeton créé
     */
    static async createToken(userId, electionId) {
        try {
            // Vérifier que l'utilisateur n'a pas déjà un jeton pour cette élection
            const existingToken = await prisma.voteToken.findFirst({
                where: {
                    userId,
                    electionId,
                    isUsed: false
                }
            });

            if (existingToken) {
                return existingToken;
            }

            // Créer un nouveau jeton
            const token = await prisma.voteToken.create({
                data: {
                    token: this.generateToken(),
                    userId,
                    electionId,
                    isUsed: false,
                    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) // Expire dans 24h
                }
            });

            return token;
        } catch (error) {
            console.error('Erreur lors de la création du jeton:', error);
            throw error;
        }
    }

    /**
     * Valide un jeton de vote
     * @param {string} token - Jeton à valider
     * @param {number} electionId - ID de l'élection
     * @returns {Object|null} Informations du jeton ou null si invalide
     */
    static async validateToken(token, electionId) {
        try {
            const voteToken = await prisma.voteToken.findFirst({
                where: {
                    token,
                    electionId,
                    isUsed: false,
                    expiresAt: {
                        gt: new Date()
                    }
                },
                include: {
                    user: {
                        include: {
                            etudiant: true
                        }
                    }
                }
            });

            return voteToken;
        } catch (error) {
            console.error('Erreur lors de la validation du jeton:', error);
            return null;
        }
    }

    /**
     * Marque un jeton comme utilisé
     * @param {string} token - Jeton à marquer
     * @returns {boolean} Succès de l'opération
     */
    static async markTokenAsUsed(token) {
        try {
            await prisma.voteToken.updateMany({
                where: { token },
                data: {
                    isUsed: true,
                    usedAt: new Date()
                }
            });
            return true;
        } catch (error) {
            console.error('Erreur lors du marquage du jeton:', error);
            return false;
        }
    }

    /**
     * Récupère tous les jetons d'une élection
     * @param {number} electionId - ID de l'élection
     * @returns {Array} Liste des jetons
     */
    static async getTokensForElection(electionId) {
        try {
            return await prisma.voteToken.findMany({
                where: { electionId },
                include: {
                    user: {
                        include: {
                            etudiant: true
                        }
                    }
                }
            });
        } catch (error) {
            console.error('Erreur lors de la récupération des jetons:', error);
            return [];
        }
    }

    /**
     * Nettoie les jetons expirés
     * @returns {number} Nombre de jetons supprimés
     */
    static async cleanupExpiredTokens() {
        try {
            const result = await prisma.voteToken.deleteMany({
                where: {
                    expiresAt: {
                        lt: new Date()
                    }
                }
            });

            console.log(`${result.count} jetons expirés supprimés`);
            return result.count;
        } catch (error) {
            console.error('Erreur lors du nettoyage des jetons:', error);
            return 0;
        }
    }
}

export default VoteToken;
