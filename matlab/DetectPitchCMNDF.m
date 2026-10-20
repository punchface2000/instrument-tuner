function [pitch]=DetectPitchCMNDF(f, W, SampleRate, UpperBound, Threshold)
% DetectPitchCMNDF - Pitch Detection using Cumulative Mean Normalized Difference Function (CMNDF)
%
% This function performs pitch detection on a given signal 'f' using the Cumulative Mean
% Normalized Difference Function (CMNDF) over a specified time window, shift boundary, and a threshold.
%
% INPUTS:
%   f          - The sampled input signal
%   W          - The width of the time window used for calculation
%                or the number of samples considered in each window.
%   SampleRate - The sample rate of the input signal 'f'.
%   Bounds     - A 2-element array specifying lower and upper bounds for shifting
%   Threshold  - The threshold value for pitch detection. If CMNDF falls below this value,
%                a pitch candidate is chosen
%
% OUTPUT:
%   pitch      - The estimated pitch in Hertz (Hz).
%
% ALGORITHM:


% env = envelope(f, SampleRate * 0.1, 'peak');
% onset = find(env > 0.1, 1, 'first') + SampleRate;
%
% if onset + W > length(f)
%     onset = length(f) - W;
% end
%
% f = f(onset:onset+W+UpperBound);
% if isempty(f)   % f can be empty if the input doesn't rise above 0.1
%     pitch = 0;
%     return
% end

env = envelope(f, SampleRate * 0.1, 'peak');

if max(env) < 0.1
    pitch = 0; % No significant amplitude, return pitch as 0
    return;
end

% Find the onset with a significant amplitude
onset = find(env > 0.1, 1, 'first') + SampleRate;

if onset + W + UpperBound > length(f)
    onset = length(f) - W - UpperBound;
end

f = f(onset:onset+W+UpperBound);

% Filter
f = f(:,1);
a = 1;
degree = 7;
b = (1/degree)*ones(1,degree);
f = filter(b,a,f);


ACF_vals0 = xcorr(f(1:1+W));
ACF_vals1 = zeros(1, UpperBound);
for i = 1:UpperBound
    ACF_vals1(i) = sum(f(i:i+W).^2);
end

StartofACF = (length(ACF_vals0)+1)/2;
ACF_positive = ACF_vals0(StartofACF:end);
DF_vals = ones(1,(length(ACF_positive)));

for i = 1:UpperBound
    DF_vals(i) = ACF_positive(1) + ACF_vals1(i) - 2*ACF_positive(i);
end

CMNDF_vals = ones(1,(length(ACF_positive)));

for i = 1:UpperBound
    CMNDF_vals(i) = i * DF_vals(i) / sum(DF_vals(1:i));
end

for i=1:length(CMNDF_vals)
    if CMNDF_vals(i) < Threshold
        Sample = zeros(1,3);
        Sample(1) = i - 1;
        Sample(2) = i;
        for j = i+1:length(CMNDF_vals)
            if CMNDF_vals(j) > Threshold
                Sample(3) = j-1;
                break
            end
        end
        A = [Sample(1)^2, Sample(1), +1;
            Sample(2)^2, Sample(2), +1;
            Sample(3)^2, Sample(3), +1];
        B = [CMNDF_vals(Sample(1));
            CMNDF_vals(Sample(2));
            CMNDF_vals(Sample(3))];
        Coeff = A\B;
        minSample = -Coeff(2)/(2*Coeff(1));
        pitch = SampleRate/minSample;
        return
    end
end

% [~, minimas] = findpeaks(-CMNDF_vals);
% Sample = minimas(1);
[~, Sample] = min(CMNDF_vals);
pitch = SampleRate/Sample;
return
end