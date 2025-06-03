/**
 * Converts a file buffer to a base64 data URI string
 * @param {Buffer} buffer - The file buffer (e.g., from multer)
 * @param {string} mimeType - The MIME type of the file (e.g., 'image/png')
 * @returns {string} The complete base64 data URI string
 */
function fileBufferToBase64(buffer, mimeType) {
  // Convert buffer to base64 string
  const base64String = buffer.toString('base64');
  
  // Create data URI with format: data:[<mediatype>];base64,<data>
  const dataUri = `data:${mimeType};base64,${base64String}`;
  
  return dataUri;
}

module.exports = {
  fileBufferToBase64
};