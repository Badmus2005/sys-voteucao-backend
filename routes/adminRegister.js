import express from 'express';
import bcrypt from 'bcrypt';
import prisma from '../prisma.js';

const router = express.Router();


router.post('/', async (req, res) => {
    try {
        const { email, password, nom, prenom, poste } = req.body;

        if (!email || !password || !nom || !prenom) {
            return res.status(400).json({ message: 'Champs requis manquants' });
        }

        // Vérifier si email déjà pris
        const existingUser = await prisma.user.findUnique({ where: { email } });
        if (existingUser) {
            return res.status(400).json({ message: 'Email déjà utilisé' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);


        // Créer user admin (poste optionnel)
        const user = await prisma.user.create({
            data: {
                email,
                password: hashedPassword,
                role: 'ADMIN',
                admin: {
                    create: {
                        nom,
                        prenom,
                        poste: poste || '',
                        email,
                    },
                },
            },
            include: { admin: true },
        });

        res.status(201).json({ message: 'Admin créé avec succès', adminId: user.admin.id });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Erreur serveur', error: error.message });
    }
});

export default router;
