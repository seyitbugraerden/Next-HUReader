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
      fields: 8,
      fieldSize: 128,
    },
  }),
)
export class AnalysisController {
  constructor(private readonly analysis: AnalysisService) {}

  private analyze(
    file: Express.Multer.File | undefined,
    body: Record<string, unknown>,
  ) {
    if (!file?.buffer.length) {
      throw new BadRequestException(
        'Analiz için bir görüntü dosyası yükleyin.',
      );
    }
    return this.analysis.analyze(
      file.buffer,
      file.originalname,
      parseOptions(body),
    );
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
