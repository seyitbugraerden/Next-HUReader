import { AnalysisController } from './analysis/analysis.controller.js';
import { AnalysisService } from './analysis/analysis.service.js';
import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';

@Module({
  imports: [],
  controllers: [AppController, AnalysisController],
  providers: [AppService, AnalysisService],
})
export class AppModule {}
