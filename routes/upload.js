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



router.post('/image', authenticateToken, async (req, res) => {
  console.log('=== DÉBUT UPLOAD ===');
  console.log('User:', req.user.id);
  console.log('Headers:', req.headers);

  try {
    // Middleware multer custom pour mieux debugger
    const multerUpload = multer({
      storage: multer.memoryStorage(),
      limits: { fileSize: 5 * 1024 * 1024 },
      fileFilter: (req, file, cb) => {
        console.log('File received:', {
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size
        });
        cb(null, true);
      }
    }).single('image');

    multerUpload(req, res, async (err) => {
      console.log('Multer callback executed');

      if (err) {
        console.error('Multer error:', err);
        return res.status(400).json({
          error: err.message,
          details: 'Multer file upload failed'
        });
      }

      if (!req.file) {
        console.log('No file in request');
        console.log('Request body:', req.body);
        console.log('Request files:', req.files);
        return res.status(400).json({
          error: 'Aucun fichier image fourni',
          details: 'Le champ "image" est vide ou manquant'
        });
      }

      console.log('File processed successfully:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size
      });

      try {
        // 1. Traitement image
        console.log('Processing image with sharp...');
        const optimizedImage = await processImage(req.file.buffer);
        console.log('Image processed successfully');

        // 2. Upload ImgBB
        console.log('Uploading to ImgBB...');
        const imageUrl = await uploadToImgBB(optimizedImage, req.file.originalname);
        console.log('ImgBB upload successful:', imageUrl);

        // 3. Sauvegarde BDD
        console.log('Saving to database...');
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
        console.error('Processing error:', error);
        res.status(500).json({
          error: error.message,
          details: 'Erreur lors du traitement'
        });
      }
    });

  } catch (error) {
    console.error('Unexpected error:', error);
    res.status(500).json({
      error: 'Erreur interne du serveur',
      details: error.message
    });
  }
});




export default router;