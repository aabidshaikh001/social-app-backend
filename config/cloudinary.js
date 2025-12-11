const cloudinary = require("cloudinary").v2
const dotenv = require("dotenv")

dotenv.config()

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// Upload file to Cloudinary
const uploadToCloudinary = async (filePath, folder) => {
  try {
    const result = await cloudinary.uploader.upload(filePath, {
      folder: folder || "real-estate-app",
    })
    return {
      url: result.secure_url,
      public_id: result.public_id,
    }
  } catch (error) {
    console.error("Error uploading to Cloudinary:", error)
    throw error
  }
}

// Delete file from Cloudinary
const deleteFromCloudinary = async (publicId) => {
  try {
    const result = await cloudinary.uploader.destroy(publicId)
    return result
  } catch (error) {
    console.error("Error deleting from Cloudinary:", error)
    throw error
  }
}

module.exports = {
  uploadToCloudinary,
  deleteFromCloudinary,
  cloudinary,
}
