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
}).single('photo');

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

// Route principale
router.post('/:type', authenticateToken, async (req, res) => {
  try {
    // 1. Upload Multer
    upload(req, res, async (err) => {
      if (err) return res.status(400).json({ error: err.message });
      if (!req.file) return res.status(400).json({ error: 'Aucun fichier fourni' });

      // 2. Traitement image
      const optimizedImage = await processImage(req.file.buffer);

      // 3. Upload ImgBB
      const imageUrl = await uploadToImgBB(optimizedImage);

      // 4. Sauvegarde BDD
      const updateMap = {
        admin: { table: 'admin', where: { userId: req.user.id } },
        etudiant: { table: 'etudiant', where: { userId: req.user.id } },
        candidate: { table: 'candidate', where: { id: req.body.candidateId } }
      };

      if (!updateMap[req.params.type]) {
        return res.status(400).json({ error: 'Type invalide' });
      }

      const updated = await prisma[updateMap[req.params.type].update({
        where: updateMap[req.params.type].where,
        data: { photoUrl: imageUrl }
      })];

      res.json({
        success: true,
        url: imageUrl,
        [req.params.type]: updated
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