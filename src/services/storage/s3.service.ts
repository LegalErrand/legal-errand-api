import {
  GetObjectCommand,
  DeleteObjectCommand,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { s3Client, S3_BUCKET, S3_FOLDERS } from "../../config/s3";
import { v4 as uuidv4 } from "uuid";

export const s3Service = {
  /**
   * Upload a file buffer to S3 (server-side upload)
   */
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    mimeType: string,
    folder: keyof typeof S3_FOLDERS
  ): Promise<{ s3Key: string; s3Url: string }> {
    const ext = originalName.split(".").pop();
    const s3Key = `${S3_FOLDERS[folder]}/${uuidv4()}.${ext}`;

    const upload = new Upload({
      client: s3Client,
      params: {
        Bucket: S3_BUCKET,
        Key: s3Key,
        Body: buffer,
        ContentType: mimeType,
      },
    });

    await upload.done();

    const s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;
    return { s3Key, s3Url };
  },

  /**
   * Generate a pre-signed GET URL — temporary read access (e.g. PDF viewer)
   * Default: 1 hour expiry
   */
  async getSignedDownloadUrl(s3Key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
    });
    return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
  },

  /**
   * Generate a pre-signed PUT URL — allows client to upload directly to S3
   * Bypasses your server for large files
   */
  async getSignedUploadUrl(
    folder: keyof typeof S3_FOLDERS,
    originalName: string,
    mimeType: string,
    expiresInSeconds = 300 // 5 minutes to complete the upload
  ): Promise<{ uploadUrl: string; s3Key: string; s3Url: string }> {
    const ext = originalName.split(".").pop();
    const s3Key = `${S3_FOLDERS[folder]}/${uuidv4()}.${ext}`;

    const command = new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: s3Key,
      ContentType: mimeType,
    });

    const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
    const s3Url = `https://${S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com/${s3Key}`;

    return { uploadUrl, s3Key, s3Url };
  },

  /**
   * Generate presigned PUT URLs for multiple files in one call.
   * Returns results in the same order as the input array.
   */
  async getBulkSignedUploadUrls(
    files: Array<{ fileName: string; mimeType: string }>,
    folder: keyof typeof S3_FOLDERS,
    expiresInSeconds = 300
  ): Promise<Array<{ uploadUrl: string; s3Key: string; s3Url: string; fileName: string }>> {
    return Promise.all(
      files.map(async ({ fileName, mimeType }) => {
        const result = await this.getSignedUploadUrl(folder, fileName, mimeType, expiresInSeconds);
        return { ...result, fileName };
      })
    );
  },

  /**
   * Check if a file exists in S3
   */
  async fileExists(s3Key: string): Promise<boolean> {
    try {
      await s3Client.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: s3Key }));
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Delete a file from S3
   */
  async deleteFile(s3Key: string): Promise<void> {
    await s3Client.send(
      new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: s3Key })
    );
  },
};
