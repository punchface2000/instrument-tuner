function [pitch] = DetectPitch(audio,SampleRate,Threshold)
    pitch = DetectPitchCMNDF(audio,SampleRate/10,SampleRate,SampleRate/20,Threshold);
end