import express from 'express';
import multer from 'multer';
import axios from 'axios';
import sharp from 'sharp';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

// Config Multer (mémoire uniquement)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB
}).single('image');

// Middleware de traitement d'image
const processImage = async (buffer) => {
  return await sharp(buffer)
    .resize(800, 800, { fit: 'inside' })
    .webp({ quality: 80 })
    .toBuffer();
};

// Upload vers ImgBB
const uploadToImgBB = async (buffer) => {
  const formData = new FormData();
  formData.append('image', buffer.toString('base64'));

  const { data } = await axios.post(
    `https://api.imgbb.com/1/upload?key=${process.env.IMGBB_API_KEY}`,
    formData,
    { headers: { 'Content-Type': 'multipart/form-data' } }
  );

  return data.data.url;
};

// Route principale pour upload d'image
router.post('/image', authenticateToken, async (req, res) => {
  try {
    // 1. Upload Multer
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

      // 2. Traitement image
      const optimizedImage = await processImage(req.file.buffer);

      // 3. Upload ImgBB
      const imageUrl = await uploadToImgBB(optimizedImage);

      // 4. Sauvegarde BDD selon le type d'utilisateur
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

      res.json({
        success: true,
        url: imageUrl,
        user: updated
      });
    });

  } catch (error) {
    console.error('Erreur upload:', error);
    res.status(500).json({
      error: error.response?.data?.error?.message || 'Échec du traitement'
    });
  }
});

export default router;