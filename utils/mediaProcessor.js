const sharp = require('sharp');
const ffmpeg = require('fluent-ffmpeg');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');

const stat = promisify(fs.stat);

const MediaProcessor = {
  // Get image dimensions
  getImageDimensions: async (filePath) => {
    try {
      const metadata = await sharp(filePath).metadata();
      return {
        width: metadata.width,
        height: metadata.height,
        format: metadata.format,
        size: (await stat(filePath)).size
      };
    } catch (error) {
      console.error('Error getting image dimensions:', error);
      return null;
    }
  },
  
  // Get video metadata
  getVideoMetadata: (filePath) => {
    return new Promise((resolve, reject) => {
      ffmpeg.ffprobe(filePath, (err, metadata) => {
        if (err) {
          console.error('Error getting video metadata:', err);
          resolve(null);
        } else {
          const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
          const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
          
          resolve({
            width: videoStream?.width || 0,
            height: videoStream?.height || 0,
            duration: Math.round(metadata.format.duration || 0),
            format: metadata.format.format_name,
            size: metadata.format.size,
            bitrate: metadata.format.bit_rate,
            codec: videoStream?.codec_name,
            audioCodec: audioStream?.codec_name,
            framerate: videoStream?.r_frame_rate
          });
        }
      });
    });
  },
  
  // Generate thumbnail for image
  generateImageThumbnail: async (sourcePath, destinationPath, width = 400, height = 400) => {
    try {
      await sharp(sourcePath)
        .resize(width, height, {
          fit: 'cover',
          position: 'center'
        })
        .jpeg({ quality: 80 })
        .toFile(destinationPath);
      
      return true;
    } catch (error) {
      console.error('Error generating image thumbnail:', error);
      return false;
    }
  },
  
  // Generate thumbnail for video
  generateVideoThumbnail: (videoPath, thumbnailPath, timeInSeconds = 1) => {
    return new Promise((resolve, reject) => {
      ffmpeg(videoPath)
        .screenshots({
          timestamps: [timeInSeconds],
          filename: path.basename(thumbnailPath),
          folder: path.dirname(thumbnailPath),
          size: '400x400'
        })
        .on('end', () => {
          resolve(true);
        })
        .on('error', (err) => {
          console.error('Error generating video thumbnail:', err);
          resolve(false);
        });
    });
  },
  
  // Compress image
  compressImage: async (sourcePath, destinationPath, quality = 80) => {
    try {
      await sharp(sourcePath)
        .jpeg({ quality })
        .toFile(destinationPath);
      return true;
    } catch (error) {
      console.error('Error compressing image:', error);
      return false;
    }
  },
  
  // Validate file size
  validateFileSize: (filePath, maxSizeMB = 100) => {
    try {
      const stats = fs.statSync(filePath);
      const fileSizeMB = stats.size / (1024 * 1024);
      return fileSizeMB <= maxSizeMB;
    } catch (error) {
      console.error('Error validating file size:', error);
      return false;
    }
  },
  
  // Get file extension
  getFileExtension: (filename) => {
    return path.extname(filename).toLowerCase().substring(1);
  },
  
  // Generate media metadata
  generateMediaMetadata: async (filePath, mediaType) => {
    try {
      let metadata = {
        fileName: path.basename(filePath),
        fileSize: (await stat(filePath)).size,
        fileFormat: path.extname(filePath).toLowerCase().substring(1)
      };
      
      if (mediaType === 'image') {
        const imageInfo = await MediaProcessor.getImageDimensions(filePath);
        if (imageInfo) {
          metadata = { ...metadata, ...imageInfo };
        }
      } else if (mediaType === 'video') {
        const videoInfo = await MediaProcessor.getVideoMetadata(filePath);
        if (videoInfo) {
          metadata = { ...metadata, ...videoInfo };
        }
      }
      
      return metadata;
    } catch (error) {
      console.error('Error generating media metadata:', error);
      return null;
    }
  }
};

module.exports = MediaProcessor;