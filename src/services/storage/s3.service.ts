import {
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import { s3Client, S3_BUCKET, S3_FOLDERS } from "../../config/s3";
import { v4 as uuidv4 } from "uuid";
import { Readable } from "stream";

export const s3Service = {
  /**
   * Upload a file buffer to S3
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

    const s3Url = `https://${S3_BUCKET}.s3.amazonaws.com/${s3Key}`;
    return { s3Key, s3Url };
  },

  /**
   * Generate a pre-signed URL for temporary access (e.g. PDF viewer)
   */
  async getSignedUrl(s3Key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: S3_BUCKET, Key: s3Key });
    return getSignedUrl(s3Client, command, { expiresIn: expiresInSeconds });
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
