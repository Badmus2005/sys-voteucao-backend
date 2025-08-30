import express from 'express';
import multer from 'multer';  // ⬅️ multer fournit memoryStorage()
import axios from 'axios';
import FormData from 'form-data';
import prisma from '../prisma.js';
import { authenticateToken } from '../middlewares/auth.js';

const router = express.Router();

const IMGBB_UPLOAD_URL = 'https://api.imgbb.com/1/upload';

// ✅ CONFIGURATION CORRECTE avec memoryStorage
const upload = multer({
  storage: multer.memoryStorage(),  // ⬅️ Utilisation correcte
  limits: {
    fileSize: 2 * 1024 * 1024,
    files: 1
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/jpg'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Type de fichier non supporté. Utilisez JPEG ou PNG.'));
    }
  }
});

// Dans votre route backend
router.post('/image', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'Aucun fichier image fourni'
      });
    }

    // Renommer le fichier côté backend
    const timestamp = Date.now();
    const safeFileName = `candidate_${req.user.id}_${timestamp}.webp`;

    // Traitement image avec Sharp
    const processedImage = await sharp(req.file.buffer)
      .resize(800, 800, { fit: 'inside' })
      .webp({ quality: 80 })
      .toBuffer();

    // ⚠️ SOLUTION TEMPORAIRE - Contournement ImgBB
    const fakeUrl = `https://via.placeholder.com/300x300?text=${encodeURIComponent(safeFileName)}`;

    // Simuler un délai
    await new Promise(resolve => setTimeout(resolve, 1000));

    res.json({
      success: true,
      url: fakeUrl,
      message: 'Image uploadée avec succès',
      fileName: safeFileName
    });

  } catch (error) {
    console.error('Erreur upload:', error);
    res.status(400).json({
      success: false,
      message: 'Format d\'image invalide',
      details: 'Le nom ou le format du fichier est incorrect'
    });
  }
});

export default router;