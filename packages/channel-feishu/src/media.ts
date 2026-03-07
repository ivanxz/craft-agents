/**
 * 飞书媒体上传和下载工具函数
 */

import { Readable } from 'stream';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { FeishuFileType, FeishuImageUploadResult, FeishuFileUploadResult } from './types';

// Constants
const IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.ico', '.tiff'];
const MAX_FILE_SIZE = 30 * 1024 * 1024; // 30MB for Feishu

/**
 * 获取飞书媒体存储目录
 */
export function getFeishuMediaDir(): string {
  const mediaDir = path.join(os.homedir(), '.craft-agent', 'feishu-media');

  if (!fs.existsSync(mediaDir)) {
    fs.mkdirSync(mediaDir, { recursive: true });
  }

  return mediaDir;
}

/**
 * 生成唯一文件名
 */
function generateFileName(prefix: string, extension: string): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}_${random}${extension}`;
}

/**
 * 上传图片到飞书
 */
export async function uploadImageToFeishu(
  client: any,
  image: Buffer | string,
  imageType: 'message' | 'avatar' = 'message'
): Promise<FeishuImageUploadResult> {
  try {
    // Validate file size if path provided
    if (typeof image === 'string') {
      const stats = fs.statSync(image);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `Image too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (limit 30MB)`,
        };
      }
    } else if (image.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Image too large: ${(image.length / 1024 / 1024).toFixed(1)}MB (limit 30MB)`,
      };
    }

    // SDK expects a Readable stream
    const imageStream = typeof image === 'string' ? fs.createReadStream(image) : Readable.from(image);

    const response = await client.im.image.create({
      data: {
        image_type: imageType,
        image: imageStream as any,
      },
    });

    const responseAny = response as any;
    if (responseAny.code !== undefined && responseAny.code !== 0) {
      return {
        success: false,
        error: `Feishu error: ${responseAny.msg || `code ${responseAny.code}`}`,
      };
    }

    const imageKey = responseAny.image_key ?? responseAny.data?.image_key;
    if (!imageKey) {
      return { success: false, error: 'No image_key returned' };
    }

    return { success: true, imageKey };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 上传文件到飞书
 */
export async function uploadFileToFeishu(
  client: any,
  file: Buffer | string,
  fileName: string,
  fileType: FeishuFileType,
  duration?: number
): Promise<FeishuFileUploadResult> {
  try {
    // Validate file size
    if (typeof file === 'string') {
      const stats = fs.statSync(file);
      if (stats.size > MAX_FILE_SIZE) {
        return {
          success: false,
          error: `File too large: ${(stats.size / 1024 / 1024).toFixed(1)}MB (limit 30MB)`,
        };
      }
    } else if (file.length > MAX_FILE_SIZE) {
      return {
        success: false,
        error: `Buffer too large: ${(file.length / 1024 / 1024).toFixed(1)}MB (limit 30MB)`,
      };
    }

    // SDK expects a Readable stream
    const fileStream = typeof file === 'string' ? fs.createReadStream(file) : Readable.from(file);

    const response = await client.im.file.create({
      data: {
        file_type: fileType,
        file_name: fileName,
        file: fileStream as any,
        ...(duration !== undefined && { duration }),
      },
    });

    const responseAny = response as any;
    if (responseAny.code !== undefined && responseAny.code !== 0) {
      return {
        success: false,
        error: `Feishu error: ${responseAny.msg || `code ${responseAny.code}`}`,
      };
    }

    const fileKey = responseAny.file_key ?? responseAny.data?.file_key;
    if (!fileKey) {
      return { success: false, error: 'No file_key returned' };
    }

    return { success: true, fileKey };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

/**
 * 检测飞书文件类型
 */
export function detectFeishuFileType(fileName: string): FeishuFileType {
  const ext = path.extname(fileName).toLowerCase();
  switch (ext) {
    case '.opus':
    case '.ogg':
      return 'opus';
    case '.mp4':
    case '.mov':
    case '.avi':
      return 'mp4';
    case '.pdf':
      return 'pdf';
    case '.doc':
    case '.docx':
      return 'doc';
    case '.xls':
    case '.xlsx':
      return 'xls';
    case '.ppt':
    case '.pptx':
      return 'ppt';
    default:
      return 'stream';
  }
}

/**
 * 检查文件是否为图片
 */
export function isFeishuImagePath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return IMAGE_EXTENSIONS.includes(ext);
}

/**
 * 检查文件是否为音频
 */
export function isFeishuAudioPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return ['.opus', '.ogg', '.mp3', '.wav', '.m4a', '.aac', '.amr'].includes(ext);
}

/**
 * 解析媒体路径
 */
export function resolveFeishuMediaPath(rawPath: string): string {
  let resolved = rawPath;

  // Handle file:// protocol
  if (resolved.startsWith('file:///')) {
    resolved = decodeURIComponent(resolved.replace('file://', ''));
  }

  // Handle ~ home directory
  if (resolved.startsWith('~')) {
    resolved = resolved.replace('~', os.homedir());
  }

  return resolved;
}

/**
 * 根据飞书媒体类型获取默认扩展名
 */
function getDefaultExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image':
      return '.jpg';
    case 'audio':
      return '.opus';
    case 'video':
      return '.mp4';
    case 'file':
      return '.bin';
    case 'media':
      return '.mp4';
    default:
      return '.bin';
  }
}

/**
 * 下载飞书消息中的媒体资源
 */
export async function downloadFeishuMedia(
  client: any,
  messageId: string,
  fileKey: string,
  type: string,
  fileName?: string
): Promise<{ localPath: string; fileSize: number } | null> {
  try {
    console.log(
      `[Feishu Media] Downloading:`,
      JSON.stringify({
        messageId,
        fileKey,
        type,
        fileName,
      })
    );

    const resp = await client.im.messageResource.get({
      params: { type },
      path: { message_id: messageId, file_key: fileKey },
    });

    // 确定文件扩展名
    let extension = getDefaultExtension(type);
    if (fileName) {
      const ext = path.extname(fileName);
      if (ext) extension = ext;
    }

    const localFileName = generateFileName(type, extension);
    const mediaDir = getFeishuMediaDir();
    const localPath = path.join(mediaDir, localFileName);

    // SDK response has writeFile method for saving to disk
    await resp.writeFile(localPath);

    const stats = fs.statSync(localPath);
    console.log(`[Feishu Media] Downloaded: ${localFileName} (${(stats.size / 1024).toFixed(1)} KB)`);

    return {
      localPath,
      fileSize: stats.size,
    };
  } catch (error: any) {
    console.error(`[Feishu Media] Download failed: ${error.message}`);
    return null;
  }
}

/**
 * 清理过期的飞书媒体文件
 */
export function cleanupOldFeishuMediaFiles(maxAgeDays: number = 7): void {
  const mediaDir = getFeishuMediaDir();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;
  const now = Date.now();

  try {
    if (!fs.existsSync(mediaDir)) {
      return;
    }

    const files = fs.readdirSync(mediaDir);
    let cleanedCount = 0;

    for (const file of files) {
      const filePath = path.join(mediaDir, file);
      try {
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > maxAgeMs) {
          fs.unlinkSync(filePath);
          cleanedCount++;
        }
      } catch (err: any) {
        console.warn(`[Feishu Media] Failed to clean ${file}: ${err.message}`);
      }
    }

    if (cleanedCount > 0) {
      console.log(`[Feishu Media] Cleaned ${cleanedCount} expired files`);
    }
  } catch (error: any) {
    console.warn(`[Feishu Media] Cleanup error: ${error.message}`);
  }
}
