import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FfmpegMediaAnalysisService } from './media-analysis.service';

/** Token de injeção. O backend injeta por ele e tipa pela interface MediaAnalysisService de ./contrato. */
export const MEDIA_ANALYSIS_SERVICE = Symbol('MEDIA_ANALYSIS_SERVICE');

@Module({
  providers: [
    {
      provide: MEDIA_ANALYSIS_SERVICE,
      inject: [ConfigService],
      useFactory: (cfg: ConfigService) =>
        new FfmpegMediaAnalysisService({
          ffmpeg: cfg.get<string>('FFMPEG_PATH') || 'ffmpeg',
          ffprobe: cfg.get<string>('FFPROBE_PATH') || 'ffprobe',
        }),
    },
  ],
  exports: [MEDIA_ANALYSIS_SERVICE],
})
export class MedicaoModule {}
