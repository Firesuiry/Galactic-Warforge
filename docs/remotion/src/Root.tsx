import {Composition} from 'remotion';
import {
  GalacticWarFactoryDesignVideo,
  galacticWarFactoryDesignDurationInFrames,
} from './GalacticWarFactoryDesignVideo';
import {SiliconWorldIntroVideo, introDurationInFrames} from './SiliconWorldIntroVideo';

export const RemotionRoot = () => {
  return (
    <>
      <Composition
        id="SiliconWorldIntro"
        component={SiliconWorldIntroVideo}
        durationInFrames={introDurationInFrames}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="GalacticWarFactoryDesign"
        component={GalacticWarFactoryDesignVideo}
        durationInFrames={galacticWarFactoryDesignDurationInFrames}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};
