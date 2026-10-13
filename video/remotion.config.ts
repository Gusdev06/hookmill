// Só vale pro CLI (studio/render). O RenderService passa as mesmas opções no renderMedia.
import { Config } from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setCodec('h264');
Config.setPixelFormat('yuv420p');
Config.setOverwriteOutput(true);
Config.setOffthreadVideoCacheSizeInBytes(256 * 1024 * 1024); // ver docs/render.md: o padrão é metade da RAM
