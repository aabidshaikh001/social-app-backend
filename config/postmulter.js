const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Ensure upload directories exist
const createUploadDirectories = () => {
  const directories = [
    'uploads',
    'uploads/posts',
    'uploads/posts/images',
    'uploads/posts/videos',
    'uploads/posts/thumbnails',
    'uploads/posts/audios',
    'uploads/posts/documents',
    'uploads/avatars',
    'uploads/temp'
  ];
  
  directories.forEach(dir => {
    const dirPath = path.join(__dirname, '..', dir);
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true });
    }
  });
};

createUploadDirectories();

// Configure storage
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    let folder = 'temp';
    
    // Determine folder based on file type
    if (file.fieldname === 'avatar') {
      folder = 'avatars';
    } else if (file.fieldname === 'media') {
      if (file.mimetype.startsWith('image/')) {
        folder = 'posts/images';
      } else if (file.mimetype.startsWith('video/')) {
        folder = 'posts/videos';
      } else if (file.mimetype.startsWith('audio/')) {
        folder = 'posts/audios';
      } else {
        folder = 'posts/documents';
      }
    } else if (file.fieldname === 'thumbnail') {
      folder = 'posts/thumbnails';
    }
    
    const uploadPath = path.join(__dirname, '..', 'uploads', folder);
    cb(null, uploadPath);
  },
  
  filename: function (req, file, cb) {
    // Generate unique filename
    const uniqueSuffix = Date.now() + '-' + crypto.randomBytes(8).toString('hex');
    const ext = path.extname(file.originalname).toLowerCase();
    const filename = file.fieldname + '-' + uniqueSuffix + ext;
    cb(null, filename);
  }
});

// File filter
const fileFilter = (req, file, cb) => {
  const allowedTypes = {
    'avatar': ['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'],
    'media': [
      // Images
      'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/svg+xml',
      // Videos
      'video/mp4', 'video/mpeg', 'video/ogg', 'video/webm', 'video/quicktime',
      // Audio
      'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm',
      // Documents
      'application/pdf', 'text/plain', 'application/msword', 
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    ],
    'thumbnail': ['image/jpeg', 'image/jpg', 'image/png', 'image/webp']
  };
  
  const fieldTypes = allowedTypes[file.fieldname];
  
  if (fieldTypes && fieldTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`Invalid file type for ${file.fieldname}. Allowed types: ${fieldTypes ? fieldTypes.join(', ') : 'none'}`), false);
  }
};

// File size limits (in bytes)
const limits = {
  fileSize: 100 * 1024 * 1024, // 100MB max file size
  files: 10 // Max 10 files per request
};

// Create multer instance
const upload = multer({
  storage: storage,
  fileFilter: fileFilter,
  limits: limits
});

// Helper functions for file management
const MediaHelper = {
  // Get file info
  getFileInfo: (file) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const fileType = file.mimetype;
    let mediaType = 'document';
    
    if (fileType.startsWith('image/')) mediaType = 'image';
    else if (fileType.startsWith('video/')) mediaType = 'video';
    else if (fileType.startsWith('audio/')) mediaType = 'audio';
    
    return {
      fileName: file.filename,
      originalName: file.originalname,
      filePath: file.path,
      fileSize: file.size,
      fileType: fileType,
      extension: ext,
      mediaType: mediaType
    };
  },
  
  // Generate thumbnail filename (for videos)
  generateThumbnailName: (filename) => {
    const name = path.parse(filename).name;
    return `thumbnail-${name}.jpg`;
  },
  
  // Generate media URL for database storage
  generateMediaUrl: (filename, mediaType) => {
    let folder = 'posts/documents';
    
    if (mediaType === 'image') folder = 'posts/images';
    else if (mediaType === 'video') folder = 'posts/videos';
    else if (mediaType === 'audio') folder = 'posts/audios';
    
    return `/uploads/${folder}/${filename}`;
  },
  
  // Generate thumbnail URL
  generateThumbnailUrl: (filename) => {
    return `/uploads/posts/thumbnails/${filename}`;
  },
  
  // Generate avatar URL
  generateAvatarUrl: (filename) => {
    return `/uploads/avatars/${filename}`;
  },
  
  // Clean up temporary files
  cleanupTempFiles: (filePaths) => {
    filePaths.forEach(filePath => {
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
        } catch (error) {
          console.error('Failed to delete temp file:', filePath, error);
        }
      }
    });
  },
  
  // Move file from temp to permanent location
  moveFile: (oldPath, newPath) => {
    return new Promise((resolve, reject) => {
      fs.rename(oldPath, newPath, (err) => {
        if (err) {
          // Try copy if rename fails (cross-device)
          const readStream = fs.createReadStream(oldPath);
          const writeStream = fs.createWriteStream(newPath);
          
          readStream.on('error', reject);
          writeStream.on('error', reject);
          
          writeStream.on('close', () => {
            fs.unlink(oldPath, (unlinkErr) => {
              if (unlinkErr) console.error('Failed to delete old file:', unlinkErr);
              resolve();
            });
          });
          
          readStream.pipe(writeStream);
        } else {
          resolve();
        }
      });
    });
  },
  
  // Delete file
  deleteFile: (filePath) => {
    if (fs.existsSync(filePath)) {
      try {
        fs.unlinkSync(filePath);
        return true;
      } catch (error) {
        console.error('Failed to delete file:', filePath, error);
        return false;
      }
    }
    return false;
  }
};

module.exports = {
  upload,
  MediaHelper
};