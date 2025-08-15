import express from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

const router = express.Router();

/**
 * Body attendu (JSON)
 * {
 *   "email": "etudiant@ucao.bj",
 *   "password": "********",
 *   "nom": "Kouassi",
 *   "prenom": "Aline",
 *   "filiere": "Informatique",
 *   "annee": 1 | 2 | 3 | ...,
 *   // 1ère année
 *   "code": "UCAO-ABCD-EFGH",
 *   // 2ème année et plus
 *   "matricule": "UUC2023-0001"
 * }
 */
router.post('/', async (req, res) => {
    try {
        const { email, password, nom, prenom, filiere, annee, code, matricule } = req.body;
        const anneeInt = parseInt(annee, 10);

        // 1) Validations de base
        if (!email || !password || !nom || !prenom || !filiere || !anneeInt) {
            return res.status(400).json({ message: 'Champs requis manquants.' });
        }
        if (anneeInt < 1) return res.status(400).json({ message: "Valeur 'annee' invalide." });

        // Vérifier l'email unique
        const emailExists = await prisma.user.findUnique({ where: { email } });
        if (emailExists) return res.status(400).json({ message: 'Email déjà utilisé.' });

        const hashedPassword = await bcrypt.hash(password, 10);

        // 2) 1ʳᵉ année : validation par code
        if (anneeInt === 1) {
            if (!code) return res.status(400).json({ message: 'Code requis pour la 1ère année.' });

            const regCode = await prisma.registrationCode.findUnique({ where: { code } });
            if (!regCode || regCode.isUsed) {
                return res.status(400).json({ message: 'Code invalide ou déjà utilisé.' });
            }

            // Transaction sécurisée : créer user + etudiant + marquer le code utilisé
            const createdUser = await prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: {
                        email,
                        password: hashedPassword,
                        role: 'ETUDIANT',
                        etudiant: {
                            create: {
                                nom,
                                prenom,
                                filiere,
                                annee: anneeInt,
                                codeInscription: code
                            }
                        }
                    },
                    include: { etudiant: true }
                });

                await tx.registrationCode.update({
                    where: { code },
                    data: { isUsed: true, usedById: user.id }
                });

                return user;
            });

            return res.status(201).json({ message: 'Inscription réussie (1ère année).', userId: createdUser.id });
        }

        // 3) 2ème année et plus : validation par matricule
        if (anneeInt >= 2) {
            if (!matricule) return res.status(400).json({ message: 'Matricule requis pour 2ème année et plus.' });

            const etuRow = await prisma.etudiant.findUnique({ where: { matricule } });
            if (!etuRow) return res.status(400).json({ message: 'Matricule introuvable. Contactez l’administration.' });
            if (etuRow.userId) return res.status(400).json({ message: 'Ce matricule est déjà utilisé.' });

            // Transaction : créer user puis compléter l'étudiant existant
            const createdUser = await prisma.$transaction(async (tx) => {
                const user = await tx.user.create({
                    data: { email, password: hashedPassword, role: 'ETUDIANT' }
                });

                await tx.etudiant.update({
                    where: { id: etuRow.id },
                    data: { userId: user.id, nom, prenom, filiere, annee: anneeInt }
                });

                return user;
            });

            return res.status(201).json({ message: 'Inscription réussie (2ème année et +).', userId: createdUser.id });
        }

        // Cas improbable
        return res.status(400).json({ message: 'Catégorie non prise en charge.' });
    } catch (err) {
        console.error('Erreur inscription:', err);
        return res.status(500).json({ message: 'Erreur serveur.' });
    }
});

export default router;
