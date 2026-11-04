import {
  BadRequestException,
  Body,
  Controller,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { AnalysisService, parseOptions } from './analysis.service.js';

@Controller('api')
@UseInterceptors(
  FileInterceptor('file', {
    storage: memoryStorage(),
    limits: {
      fileSize: 20 * 1024 * 1024,
      files: 1,
      fields: 14,
      fieldSize: 1024 * 1024,
    },
  }),
)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  @Post('preview')
  async preview(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res() response: Response,
  ) {
    if (!file?.buffer.length)
      throw new BadRequestException(
        'Önizleme için bir görüntü dosyası yükleyin.',
      );
    const preview = await this.analysis.preview(file.buffer);
    response.setHeader('Cache-Control', 'no-store');
    return response.json(preview);
  }

  private analyze(
    file: Express.Multer.File | undefined,
    body: Record<string, unknown>,
  ) {
    if (!file?.buffer.length) {
      throw new BadRequestException(
        'Analiz için bir görüntü dosyası yükleyin.',
      );
    }
    const sourcePath = body.sourcePath;
    if (
      sourcePath !== undefined &&
      (typeof sourcePath !== 'string' ||
        !sourcePath ||
        sourcePath.length > 4096 ||
        sourcePath.startsWith('/') ||
        sourcePath.includes('\\') ||
        sourcePath.includes('\0') ||
        sourcePath
          .split('/')
          .some((part) => !part || part === '.' || part === '..'))
    ) {
      throw new BadRequestException(
        'Klasör içi yol geçerli bir göreli dosya yolu olmalıdır.',
      );
    }
    return this.analysis.analyze(
      file.buffer,
      typeof sourcePath === 'string' ? sourcePath : file.originalname,
      parseOptions(body),
    );
  }

  @Post('defects/preview')
  async previewDefects(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const { defects, roi, preview, width, height, unit } = await this.analyze(
      file,
      { ...body, defectEdits: undefined },
    );
    response.setHeader('Cache-Control', 'no-store');
    return response.json({ defects, roi, preview, width, height, unit });
  }

  @Post('analyze')
  async run(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await this.analyze(file, body);
    response.setHeader('Cache-Control', 'no-store');
    return response.json(result);
  }

  @Post('export')
  async export(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: Record<string, unknown>,
    @Res() response: Response,
  ) {
    const result = await this.analyze(file, body);
    const workbook = await this.analysis.exportExcel(result);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
    response.setHeader(
      'Content-Disposition',
      'attachment; filename="HUReader-rapor.xlsx"',
    );
    return response.send(workbook);
  }
}
