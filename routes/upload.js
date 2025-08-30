import express from 'express';
import multer from 'multer';
import axios from 'axios';
import sharp from 'sharp';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';
import FormData from 'form-data'; // Import correct pour Node.js

const router = express.Router();

// Config Multer
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('image'); // Nom du champ attendu

// Middleware de traitement d'image
const processImage = async (buffer) => {
  return await sharp(buffer)
    .resize(800, 800, { fit: 'inside' })
    .webp({ quality: 80 })
    .toBuffer();
};

// Upload vers ImgBB 
const uploadToImgBB = async (buffer, originalName) => {
  try {
    // Créer FormData correctement pour Node.js
    const formData = new FormData();

    // Ajouter le buffer directement comme fichier
    formData.append('image', buffer, {
      filename: originalName || 'image.webp',
      contentType: 'image/webp'
    });

    const response = await axios.post(
      `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
      formData,
      {
        headers: {
          ...formData.getHeaders(),
          'Content-Type': 'multipart/form-data'
        }
      }
    );

    return response.data.data.url;
  } catch (error) {
    console.error('Erreur ImgBB:', error.response?.data || error.message);
    throw new Error(error.response?.data?.error?.message || 'Erreur ImgBB');
  }
};

// Route principale pour upload d'image - CORRIGÉ
router.post('/image', authenticateToken, async (req, res) => {
  try {
    // Gérer l'upload avec multer
    const multerUpload = upload;

    multerUpload(req, res, async (err) => {
      if (err) {
        return res.status(400).json({
          error: err.message === 'File too large'
            ? 'Le fichier est trop volumineux (max 5MB)'
            : err.message
        });
      }

      if (!req.file) {
        return res.status(400).json({ error: 'Aucun fichier image fourni' });
      }

      try {
        // 1. Traitement image
        console.log('Traitement image...');
        const optimizedImage = await processImage(req.file.buffer);

        // 2. Upload ImgBB
        console.log('Upload vers ImgBB...');
        const imageUrl = await uploadToImgBB(optimizedImage, req.file.originalname);

        // 3. Sauvegarde BDD
        console.log('Sauvegarde BDD...');
        const user = await prisma.user.findUnique({
          where: { id: req.user.id },
          include: { etudiant: true, admin: true }
        });

        let updated;
        if (user.role === 'ETUDIANT' && user.etudiant) {
          updated = await prisma.etudiant.update({
            where: { userId: req.user.id },
            data: { photoUrl: imageUrl }
          });
        } else if (user.role === 'ADMIN' && user.admin) {
          updated = await prisma.admin.update({
            where: { userId: req.user.id },
            data: { photoUrl: imageUrl }
          });
        } else {
          return res.status(400).json({ error: 'Type d\'utilisateur non reconnu' });
        }

        // 4. Réponse succès
        res.json({
          success: true,
          message: 'Image uploadée avec succès',
          url: imageUrl,
          user: updated
        });

      } catch (error) {
        console.error('Erreur traitement:', error);
        res.status(500).json({
          error: error.message || 'Erreur lors du traitement de l\'image'
        });
      }
    });

  } catch (error) {
    console.error('Erreur upload:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur'
    });
  }
});

export default router;