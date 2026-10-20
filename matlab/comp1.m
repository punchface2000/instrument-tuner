classdef comp1 < matlab.ui.componentcontainer.ComponentContainer

    % Properties that correspond to underlying components
    properties (Access = private, Transient, NonCopyable)
        GridLayout             matlab.ui.container.GridLayout
        Button6                matlab.ui.control.StateButton
        Button5                matlab.ui.control.StateButton
        Button4                matlab.ui.control.StateButton
        Button3                matlab.ui.control.StateButton
        Button2                matlab.ui.control.StateButton
        Button1                matlab.ui.control.StateButton
        InputLabel             matlab.ui.control.Label
        TuningLabel            matlab.ui.control.Label
        HowtoUseButton         matlab.ui.control.Button
        Lamp                   matlab.ui.control.Lamp
        TextArea               matlab.ui.control.TextArea
        InputDropDown          matlab.ui.control.DropDown
        StartResetButton       matlab.ui.control.Button
        Gauge                  matlab.ui.control.SemicircularGauge
        ModeButtonGroup        matlab.ui.container.ButtonGroup
        ChromaticButton        matlab.ui.control.ToggleButton
        ManualButton           matlab.ui.control.ToggleButton
        AutomaticButton        matlab.ui.control.ToggleButton
        InstrumentButtonGroup  matlab.ui.container.ButtonGroup
        ViolinButton           matlab.ui.control.ToggleButton
        BassButton             matlab.ui.control.ToggleButton
        GuitarButton           matlab.ui.control.ToggleButton
    end

    properties (Access = public)
        AvailableInputs % Audio Inputs
        ButtonsState = 0;
        FrameDuration = 0.2;
        Instrument string = "Guitar"; % The Instrument being chosen to tune
        Mode = 0; % Tuning Mode
        Notes
        NotesFrequencies
        SampleRate double = 44100; % Sample Rate
        SamplesPerFrame
        SelectedInput
        Threshold double = 0.1; % YIN Threshold
        audioReader
    end
    
    properties (Access = public, Constant)
        BassFrequencies double = [41.2034 55 73.4162 97.9989];
        BassNotes string = 'E1A1D2G2';
        GuitarFrequencies double = [82.4069, 110.000, 146.8324, 195.9977, 246.9417, 329.6276];
        GuitarNotes string = 'E2A2D3G3B3E4';
        ViolinFrequencies double = [195.5556 293.3333 440 659.2551];
        ViolinNotes string = 'G3D4A4E5';
    end
    

    methods (Access = private)

    end

    methods (Static)
        function [Frequencies, Notes] = NotesFrequenciesArrays()
            % Constants
            referenceFrequency = 440; % A4

            Notes = {'C1', 'C#1/Db1', 'D1', 'D#1/Eb1', 'E1', 'F1', 'F#1/Gb1', 'G1', 'G#1/Ab1', 'A1', 'A#1/Bb1', 'B1', ...
                'C2', 'C#2/Db2', 'D2', 'D#2/Eb2', 'E2', 'F2', 'F#2/Gb2', 'G2', 'G#2/Ab2', 'A2', 'A#2/Bb2', 'B2', ...
                'C3', 'C#3/Db3', 'D3', 'D#3/Eb3', 'E3', 'F3', 'F#3/Gb3', 'G3', 'G#3/Ab3', 'A3', 'A#3/Bb3', 'B3', ...
                'C4', 'C#4/Db4', 'D4', 'D#4/Eb4', 'E4', 'F4', 'F#4/Gb4', 'G4', 'G#4/Ab4', 'A4', 'A#4/Bb4', 'B4', ...
                'C5', 'C#5/Db5', 'D5', 'D#5/Eb5', 'E5', 'F5', 'F#5/Gb5', 'G5', 'G#5/Ab5', 'A5', 'A#5/Bb5', 'B5', ...
                'C6', 'C#6/Db6', 'D6', 'D#6/Eb6', 'E6', 'F6', 'F#6/Gb6', 'G6', 'G#6/Ab6', 'A6', 'A#6/Bb6', 'B6'}; % Notes from C1 to B6
            numNotes = length(Notes);
            Frequencies = zeros(numNotes, 1);

            for i = 1:numNotes
                % Calculate semitone difference from A4
                semitoneDiff = i - 46; % A4 is the 46th note in the array
                Frequencies(i) = referenceFrequency * (2^(semitoneDiff / 12));
            end
        end
    end


    % Callbacks that handle component events
    methods (Access = private)

        % Callback function
        function StartTuning(comp, event)
            comp.audioReader = audioDeviceReader(...
                'SampleRate', comp.SampleRate, ...
                'SamplesPerFrame', comp.SamplesPerFrame, ...
                'NumChannels', 1, ...
                'DeviceName', comp.SelectedInput ...
                );
            switch comp.Instrument
                case "Guitar"
                    comp.Button1.Text = 'D3';
                    comp.Button1.Visible = 1;
                    comp.Button2.Text = 'A2';
                    comp.Button2.Visible = 1;
                    comp.Button3.Text = 'E2';
                    comp.Button3.Visible = 1;
                    comp.Button4.Text = 'G3';
                    comp.Button4.Visible = 1;
                    comp.Button5.Text = 'B3';
                    comp.Button5.Visible = 1;
                    comp.Button6.Text = 'E4';
                    comp.Button6.Visible = 1;
                    comp.Lamp.Color = [1.00,0.00,0.00];
                    switch comp.Mode
                        case 0  % Automatic mode
                            while comp.Mode == 0 && comp.Instrument == "Guitar"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=50 && pitch<=500
                                        [~, closest_string] = min(abs(pitch-comp.GuitarFrequencies));
                                        cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(closest_string));
                                        comp.Gauge.Value = cents_deviation;
                                        Note = extractBetween(comp.GuitarNotes,2*closest_string-1,2*closest_string);
                                        switch Note
                                            case "E2"
                                                if abs(cents_deviation) <= 5
                                                    comp.Button3.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button3.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button3.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "A2"
                                                if abs(cents_deviation) <= 5
                                                    comp.Button2.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button2.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button2.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "D3"
                                                if abs(cents_deviation) <= 5
                                                    comp.Button1.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button1.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button1.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "G3"
                                                if abs(cents_deviation) <= 5
                                                    comp.Button4.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button4.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button4.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "B3"
                                                if abs(cents_deviation) <= 5
                                                    comp.Button5.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button5.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button5.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "E4"
                                                if abs(cents_deviation) <= 5
                                                    comp.Button6.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button6.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button6.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                        end
                                        comp.TextArea.Value = ['Detected Pitch: ' num2str(pitch) ' Hz'];
                                    end
                                end
                                pause(0.01);
                            end
                        case 1  % Manual mode
                            while comp.ButtonsState ~= 0 && comp.Mode == 1 && comp.Instrument == "Guitar"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=50 && pitch<=500
                                        switch comp.ButtonsState    % Which string is being tuned
                                            case 1  % D3
                                                cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(3));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button1.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 2  % A2
                                                cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(2));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button2.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 3  % E2
                                                cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(1));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button3.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 4  % G3
                                                cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(4));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button4.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 5  % B3
                                                cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(5));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button5.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 6  % E4
                                                cents_deviation = 1200 * log2(pitch / comp.GuitarFrequencies(6));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button6.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                        end
                                        comp.TextArea.Value = ['Detected Pitch: ' num2str(pitch) ' Hz'];
                                    end
                                end
                                pause(0.01);
                            end
                        case 2 % Chromatic Mode
                            if isempty(comp.Notes) | isempty(comp.NotesFrequencies)
                                [comp.NotesFrequencies, comp.Notes] = comp.NotesFrequenciesArrays();
                            end
                            while comp.Mode == 2 && comp.Instrument == "Guitar"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=20 && pitch<=2000
                                        [~, closest_note] = min(abs(pitch-comp.NotesFrequencies));
                                        cents_deviation = 1200 * log2(pitch / comp.NotesFrequencies(closest_note));
                                        comp.Gauge.Value = cents_deviation;
                                        Note = comp.Notes{closest_note};
                                        comp.TextArea.Value = strjoin({['Detected Pitch: ' num2str(pitch) ' Hz'];
                                            ['Detected Note: ' Note];
                                            ['Cents deviation: ' num2str(cents_deviation)]}, '\n');
                                    end
                                end
                                pause(0.01);
                            end
                    end
                case "Bass"
                    comp.Button1.Text = 'A1';
                    comp.Button1.Visible = 1;
                    comp.Button2.Text = 'E1';
                    comp.Button2.Visible = 1;
                    comp.Button3.Visible = 0;
                    comp.Button4.Text = 'D2';
                    comp.Button4.Visible = 1;
                    comp.Button5.Text = 'G2';
                    comp.Button5.Visible = 1;
                    comp.Button6.Visible = 0;
                    comp.Lamp.Color = [1.00,0.00,0.00];
                    switch comp.Mode
                        case 0  % Automatic mode
                            while comp.Mode == 0 && comp.Instrument == "Bass"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=20 && pitch<=150
                                        [~, closest_string] = min(abs(pitch-comp.BassFrequencies));
                                        cents_deviation = 1200 * log2(pitch / comp.BassFrequencies(closest_string));
                                        comp.Gauge.Value = cents_deviation;
                                        Note = extractBetween(comp.BassNotes,2*closest_string-1,2*closest_string);
                                        switch Note
                                            case "E1"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button2.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button2.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button2.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "A1"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button1.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button1.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button1.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "D2"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button4.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button4.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button4.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "G2"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button5.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button5.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button5.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                        end
                                        comp.TextArea.Value = ['Detected Pitch: ' num2str(pitch) ' Hz'];
                                    end
                                end
                                pause(0.01);
                            end
                        case 1  %Manual mode
                            while comp.ButtonsState ~= 0 && comp.Mode == 1 && comp.Instrument == "Bass"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=50 && pitch<=500
                                        switch comp.ButtonsState    % Which string is being tuned
                                            case 1  % A1
                                                cents_deviation = 1200 * log2(pitch / comp.BassFrequencies(2));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button1.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 2  % E1
                                                cents_deviation = 1200 * log2(pitch / comp.BassFrequencies(1));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button2.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 4  % D2
                                                cents_deviation = 1200 * log2(pitch / comp.BassFrequencies(3));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button4.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 5  % G2
                                                cents_deviation = 1200 * log2(pitch / comp.BassFrequencies(4));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button5.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                        end
                                        comp.TextArea.Value = ['Detected Pitch: ' num2str(pitch) ' Hz'];
                                    end
                                end
                                pause(0.01);
                            end
                        case 2 % Chromatic Mode
                            if isempty(comp.Notes) | isempty(comp.NotesFrequencies)
                                [comp.NotesFrequencies, comp.Notes] = comp.NotesFrequenciesArrays();
                            end
                            while comp.Mode == 2 && comp.Instrument == "Bass"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=20 && pitch<=2000
                                        [~, closest_note] = min(abs(pitch-comp.NotesFrequencies));
                                        cents_deviation = 1200 * log2(pitch / comp.NotesFrequencies(closest_note));
                                        comp.Gauge.Value = cents_deviation;
                                        Note = comp.Notes{closest_note};
                                        comp.TextArea.Value = strjoin({['Detected Pitch: ' num2str(pitch) ' Hz'];
                                            ['Detected Note: ' Note];
                                            ['Cents deviation: ' num2str(cents_deviation)]}, '\n');
                                    end
                                end
                                pause(0.01);
                            end
                    end
                case "Violin"
                    comp.Button1.Text = 'D4';
                    comp.Button1.Visible = 1;
                    comp.Button2.Text = 'G3';
                    comp.Button2.Visible = 1;
                    comp.Button3.Visible = 0;
                    comp.Button4.Text = 'A4';
                    comp.Button4.Visible = 1;
                    comp.Button5.Text = 'E5';
                    comp.Button5.Visible = 1;
                    comp.Button6.Visible = 0;
                    comp.Lamp.Color = [1.00,0.00,0.00];
                    switch comp.Mode
                        case 0  % Automatic mode
                            while comp.Mode == 0 && comp.Instrument == "Violin"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=100 && pitch<=1000
                                        [~, closest_string] = min(abs(pitch-comp.ViolinFrequencies));
                                        cents_deviation = 1200 * log2(pitch / comp.ViolinFrequencies(closest_string));
                                        comp.Gauge.Value = cents_deviation;
                                        Note = extractBetween(comp.ViolinNotes,2*closest_string-1,2*closest_string);
                                        switch Note
                                            case "G3"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button2.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button2.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button2.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "D4"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button1.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button1.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button1.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "A4"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button4.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button4.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button4.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                            case "E5"
                                                if abs(cents_deviation) <= 10
                                                    comp.Button5.BackgroundColor = [0.39,0.83,0.07];
                                                elseif comp.Button5.BackgroundColor ~= [0.39,0.83,0.07] %| abs(cents_deviations) >= 10
                                                    comp.Button5.BackgroundColor = [1.00,0.41,0.16];
                                                end
                                        end
                                        comp.TextArea.Value = ['Detected Pitch: ' num2str(pitch) ' Hz'];
                                    end
                                end
                                pause(0.01);
                            end
                        case 1  %Manual mode
                            while comp.ButtonsState ~= 0 && comp.Mode == 1 && comp.Instrument == "Violin"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=100 && pitch<=1000
                                        switch comp.ButtonsState    % Which string is being tuned
                                            case 1  % D4
                                                cents_deviation = 1200 * log2(pitch / comp.ViolinFrequencies(2));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button1.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 2  % G3
                                                cents_deviation = 1200 * log2(pitch / comp.ViolinFrequencies(1));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button2.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 4  % A4
                                                cents_deviation = 1200 * log2(pitch / comp.ViolinFrequencies(3));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button4.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                            case 5  % E5
                                                cents_deviation = 1200 * log2(pitch / comp.ViolinFrequencies(4));
                                                comp.Gauge.Value = cents_deviation;
                                                if abs(cents_deviation) <= 5
                                                    comp.Button5.BackgroundColor = [0.39,0.83,0.07];
                                                end
                                        end
                                        comp.TextArea.Value = ['Detected Pitch: ' num2str(pitch) ' Hz'];
                                    end
                                end
                                pause(0.01);
                            end
                        case 2 % Chromatic Mode
                            if isempty(comp.Notes) | isempty(comp.NotesFrequencies)
                                [comp.NotesFrequencies, comp.Notes] = comp.NotesFrequenciesArrays();
                            end
                            while comp.Mode == 2 && comp.Instrument == "Violin"
                                comp.Lamp.Color = [0.00,1.00,0.00];
                                audioData = comp.audioReader();
                                if length(audioData) >= comp.SamplesPerFrame
                                    pitch = DetectPitch(audioData,comp.SampleRate,comp.Threshold);
                                    if pitch>=20 && pitch<=2000
                                        [~, closest_note] = min(abs(pitch-comp.NotesFrequencies));
                                        cents_deviation = 1200 * log2(pitch / comp.NotesFrequencies(closest_note));
                                        comp.Gauge.Value = cents_deviation;
                                        Note = comp.Notes{closest_note};
                                        comp.TextArea.Value = strjoin({['Detected Pitch: ' num2str(pitch) ' Hz'];
                                            ['Detected Note: ' Note];
                                            ['Cents deviation: ' num2str(cents_deviation)]}, '\n');
                                    end
                                end
                                pause(0.01);
                            end
                    end
            end
        end

        % Button pushed function: StartResetButton
        function StartResetButtonPushed(comp, event)
            comp.Mode = 0;
            comp.Instrument = "Guitar";
            comp.ModeButtonGroup.SelectedObject = comp.AutomaticButton;
            comp.InstrumentButtonGroup.SelectedObject = comp.GuitarButton;
            comp.ModeButtonGroup.Enable = 1;
            comp.InstrumentButtonGroup.Enable = 1;
            comp.Gauge.Visible = 1;
            comp.Gauge.Value = 0;
            comp.TextArea.Value = '';
            comp.TextArea.Visible = 1;
            comp.AvailableInputs = audiodevinfo; % Fetch audio input device information
            InputNames = {comp.AvailableInputs.input.Name}; % Extract input names
            if isempty(InputNames)
                comp.InputDropDown.Items = 'Empty';
            else
                InputNamesSliced = InputNames(2:end);
                for i = 1:numel(InputNamesSliced)
                    InputNamesSliced{i} = strrep(InputNamesSliced{i},' (Windows DirectSound)', '');
                end
                comp.InputDropDown.Items = InputNamesSliced;
                comp.InputDropDown.Enable = 1;
            end
            comp.SelectedInput = comp.InputDropDown.Value;
            comp.SamplesPerFrame = comp.FrameDuration * comp.SampleRate;
            comp.Button1.BackgroundColor = [0.96,0.96,0.96];
            comp.Button2.BackgroundColor = [0.96,0.96,0.96];
            comp.Button3.BackgroundColor = [0.96,0.96,0.96];
            comp.Button4.BackgroundColor = [0.96,0.96,0.96];
            comp.Button5.BackgroundColor = [0.96,0.96,0.96];
            comp.Button6.BackgroundColor = [0.96,0.96,0.96];
            comp.Button1.Value = 0;
            comp.Button2.Value = 0;
            comp.Button3.Value = 0;
            comp.Button4.Value = 0;
            comp.Button5.Value = 0;
            comp.Button6.Value = 0;
            comp.ButtonsState = 0;
            comp.Button1.Visible = 1;
            comp.Button2.Visible = 1;
            comp.Button3.Visible = 1;
            comp.Button4.Visible = 1;
            comp.Button5.Visible = 1;
            comp.Button6.Visible = 1;
            comp.TuningLabel.Visible = 1;
            comp.Lamp.Visible = 1;
            StartTuning(comp,event);
        end

        % Value changed function: InputDropDown
        function InputDropDownValueChanged(comp, event)
            comp.SelectedInput = comp.InputDropDown.Value;
            StartTuning(comp,event);
        end

        % Selection changed function: ModeButtonGroup
        function ModeButtonGroupSelectionChanged(comp, event)
            if comp.ModeButtonGroup.SelectedObject.Text == "Automatic"
                comp.Mode = 0;
            elseif comp.ModeButtonGroup.SelectedObject.Text == "Manual"
                comp.Mode = 1;
            elseif comp.ModeButtonGroup.SelectedObject.Text == "Chromatic"
                comp.Mode = 2;
            end
            comp.Button1.BackgroundColor = [0.96,0.96,0.96];
            comp.Button2.BackgroundColor = [0.96,0.96,0.96];
            comp.Button3.BackgroundColor = [0.96,0.96,0.96];
            comp.Button4.BackgroundColor = [0.96,0.96,0.96];
            comp.Button5.BackgroundColor = [0.96,0.96,0.96];
            comp.Button6.BackgroundColor = [0.96,0.96,0.96];
            comp.Button1.Value = 0;
            comp.Button2.Value = 0;
            comp.Button3.Value = 0;
            comp.Button4.Value = 0;
            comp.Button5.Value = 0;
            comp.Button6.Value = 0;
            comp.ButtonsState = 0;
            StartTuning(comp, event);
        end

        % Selection changed function: InstrumentButtonGroup
        function InstrumentButtonGroupSelectionChanged(comp, event)
            comp.Instrument = comp.InstrumentButtonGroup.SelectedObject.Text;
            comp.Button1.BackgroundColor = [0.96,0.96,0.96];
            comp.Button2.BackgroundColor = [0.96,0.96,0.96];
            comp.Button3.BackgroundColor = [0.96,0.96,0.96];
            comp.Button4.BackgroundColor = [0.96,0.96,0.96];
            comp.Button5.BackgroundColor = [0.96,0.96,0.96];
            comp.Button6.BackgroundColor = [0.96,0.96,0.96];
            comp.Button1.Value = 0;
            comp.Button2.Value = 0;
            comp.Button3.Value = 0;
            comp.Button4.Value = 0;
            comp.Button5.Value = 0;
            comp.Button6.Value = 0;
            comp.ButtonsState = 0;
            StartTuning(comp,event);
        end

        % Button pushed function: HowtoUseButton
        function HowtoUseButtonPushed(comp, event)
            persistent howToFigure;
            if isempty(howToFigure) || ~isvalid(howToFigure)  % if there is no Figure or no Figure window being opened
                howToFigure = figure('Name', 'How to Use', 'NumberTitle', 'off');
                instructionText = {'Welcome to my instrument tuning app';
                    'Available instrument: Guitar, Bass, Violin';
                    'Instruction:';
                    '1. Press the Start/Reset button to begin.';
                    '2. Choose the desired input source for the tuner.';
                    '3. Select the instrument (default is Guitar).';
                    '4. Choose the tuning mode:';
                    '   - Automatic (Default): Play a string, and the app will identify the closest string for tuning.';
                    '   - Manual: Select a string using buttons and tune that string manually.';
                    '   - Chromatic: Listen to the note and see the closest note with the cents deviation.';
                    '5. Use the gauge to visualize the cents deviation.';
                    '6. Buttons turn orange if the note is not in tune:(.';
                    '   When in tune (cents deviation <= 5), the button turns green:).'};

                uicontrol('Parent', howToFigure, 'Style', 'text', ...
                    'String', instructionText, ...
                    'FontSize', 12, ...
                    'HorizontalAlignment', 'left', ...
                    'Position', [20 20 460 400]);   % left bottom width height
            else    % Bring windows to front
                figure(howToFigure);
            end
        end

        % Value changed function: Button1
        function Button1ValueChanged(comp, event)
            if comp.Mode == 1   % In manual mode
                if comp.Button1.Value == 1
                    comp.Button2.Value = 0;
                    comp.Button3.Value = 0;
                    comp.Button4.Value = 0;
                    comp.Button5.Value = 0;
                    comp.Button6.Value = 0;
                    comp.ButtonsState = 1;
                    comp.Button1.BackgroundColor = [1.00,0.41,0.16];
                    StartTuning(comp, event);
                else
                    comp.ButtonsState = 0;
                    StartTuning(comp, event);
                end
            else
                comp.Button1.Value = 0; % If not in Manual mode, Button state stays 0
            end
        end

        % Value changed function: Button2
        function Button2ValueChanged(comp, event)
            if comp.Mode == 1   % In manual mode
                if comp.Button2.Value == 1
                    comp.Button1.Value = 0;
                    comp.Button3.Value = 0;
                    comp.Button4.Value = 0;
                    comp.Button5.Value = 0;
                    comp.Button6.Value = 0;
                    comp.ButtonsState = 2;
                    comp.Button2.BackgroundColor = [1.00,0.41,0.16];
                    StartTuning(comp, event);
                else
                    comp.ButtonsState = 0;
                    StartTuning(comp, event);
                end
            else
                comp.Button2.Value = 0; % If not in Manual mode, Button state stays 0
            end
        end

        % Value changed function: Button3
        function Button3ValueChanged(comp, event)
            if comp.Mode == 1   % In manual mode
                if comp.Button3.Value == 1
                    comp.Button1.Value = 0;
                    comp.Button2.Value = 0;
                    comp.Button4.Value = 0;
                    comp.Button5.Value = 0;
                    comp.Button6.Value = 0;
                    comp.ButtonsState = 3;
                    comp.Button3.BackgroundColor = [1.00,0.41,0.16];
                    StartTuning(comp, event);
                else
                    comp.ButtonsState = 0;
                    StartTuning(comp, event);
                end
            else
                comp.Button3.Value = 0; % If not in Manual mode, Button state stays 0
            end
        end

        % Value changed function: Button4
        function Button4ValueChanged(comp, event)
            if comp.Mode == 1   % In manual mode
                if comp.Button4.Value == 1
                    comp.Button1.Value = 0;
                    comp.Button2.Value = 0;
                    comp.Button3.Value = 0;
                    comp.Button5.Value = 0;
                    comp.Button6.Value = 0;
                    comp.ButtonsState = 4;
                    comp.Button4.BackgroundColor = [1.00,0.41,0.16];
                    StartTuning(comp, event);
                else
                    comp.ButtonsState = 0;
                    StartTuning(comp, event);
                end
            else
                comp.Button4.Value = 0; % If not in Manual mode, Button state stays 0
            end
        end

        % Value changed function: Button5
        function Button5ValueChanged(comp, event)
            if comp.Mode == 1   % In manual mode
                if comp.Button5.Value == 1
                    comp.Button1.Value = 0;
                    comp.Button2.Value = 0;
                    comp.Button3.Value = 0;
                    comp.Button4.Value = 0;
                    comp.Button6.Value = 0;
                    comp.ButtonsState = 5;
                    comp.Button5.BackgroundColor = [1.00,0.41,0.16];
                    StartTuning(comp, event);
                else
                    comp.ButtonsState = 0;
                    StartTuning(comp, event);
                end
            else
                comp.Button5.Value = 0; % If not in Manual mode, Button state stays 0
            end
        end

        % Value changed function: Button6
        function Button6ValueChanged(comp, event)
            if comp.Mode == 1   % In manual mode
                if comp.Button6.Value == 1
                    comp.Button1.Value = 0;
                    comp.Button2.Value = 0;
                    comp.Button3.Value = 0;
                    comp.Button4.Value = 0;
                    comp.Button5.Value = 0;
                    comp.ButtonsState = 6;
                    comp.Button6.BackgroundColor = [1.00,0.41,0.16];
                    StartTuning(comp, event);
                else
                    comp.ButtonsState = 0;
                    StartTuning(comp, event);
                end
            else
                comp.Button6.Value = 0; % If not in Manual mode, Button state stays 0
            end
        end
    end

    methods (Access = protected)
        
        % Code that executes when the value of a public property is changed
        function update(comp)
            % Use this function to update the underlying components

        end

        % Create the underlying components
        function setup(comp)

            comp.Position = [1 1 579 519];
            comp.BackgroundColor = [0.94 0.94 0.94];

            % Create GridLayout
            comp.GridLayout = uigridlayout(comp);
            comp.GridLayout.ColumnWidth = {'0.25x', '0.25x', '0.15x', '0.85x', '0.2x', '0.3x'};
            comp.GridLayout.RowHeight = {'fit', 'fit', '1x', 'fit', 'fit', 'fit', '0.5x', '1x'};

            % Create InstrumentButtonGroup
            comp.InstrumentButtonGroup = uibuttongroup(comp.GridLayout);
            comp.InstrumentButtonGroup.SelectionChangedFcn = matlab.apps.createCallbackFcn(comp, @InstrumentButtonGroupSelectionChanged, true);
            comp.InstrumentButtonGroup.Enable = 'off';
            comp.InstrumentButtonGroup.Title = 'Instrument';
            comp.InstrumentButtonGroup.Layout.Row = 3;
            comp.InstrumentButtonGroup.Layout.Column = [1 2];

            % Create GuitarButton
            comp.GuitarButton = uitogglebutton(comp.InstrumentButtonGroup);
            comp.GuitarButton.Text = 'Guitar';
            comp.GuitarButton.Position = [11 77 100 23];
            comp.GuitarButton.Value = true;

            % Create BassButton
            comp.BassButton = uitogglebutton(comp.InstrumentButtonGroup);
            comp.BassButton.Text = 'Bass';
            comp.BassButton.Position = [11 56 100 23];

            % Create ViolinButton
            comp.ViolinButton = uitogglebutton(comp.InstrumentButtonGroup);
            comp.ViolinButton.Text = 'Violin';
            comp.ViolinButton.Position = [11 35 100 23];

            % Create ModeButtonGroup
            comp.ModeButtonGroup = uibuttongroup(comp.GridLayout);
            comp.ModeButtonGroup.SelectionChangedFcn = matlab.apps.createCallbackFcn(comp, @ModeButtonGroupSelectionChanged, true);
            comp.ModeButtonGroup.Enable = 'off';
            comp.ModeButtonGroup.Title = 'Mode';
            comp.ModeButtonGroup.Layout.Row = 3;
            comp.ModeButtonGroup.Layout.Column = [5 6];

            % Create AutomaticButton
            comp.AutomaticButton = uitogglebutton(comp.ModeButtonGroup);
            comp.AutomaticButton.Text = 'Automatic';
            comp.AutomaticButton.Position = [11 77 100 23];
            comp.AutomaticButton.Value = true;

            % Create ManualButton
            comp.ManualButton = uitogglebutton(comp.ModeButtonGroup);
            comp.ManualButton.Text = 'Manual';
            comp.ManualButton.Position = [11 56 100 23];

            % Create ChromaticButton
            comp.ChromaticButton = uitogglebutton(comp.ModeButtonGroup);
            comp.ChromaticButton.Text = 'Chromatic';
            comp.ChromaticButton.Position = [11 35 100 23];

            % Create Gauge
            comp.Gauge = uigauge(comp.GridLayout, 'semicircular');
            comp.Gauge.Limits = [-100 100];
            comp.Gauge.MajorTicks = [-100 -50 0 50 100];
            comp.Gauge.Visible = 'off';
            comp.Gauge.Layout.Row = [4 6];
            comp.Gauge.Layout.Column = [3 4];

            % Create StartResetButton
            comp.StartResetButton = uibutton(comp.GridLayout, 'push');
            comp.StartResetButton.ButtonPushedFcn = matlab.apps.createCallbackFcn(comp, @StartResetButtonPushed, true);
            comp.StartResetButton.Layout.Row = 2;
            comp.StartResetButton.Layout.Column = [1 2];
            comp.StartResetButton.Text = 'Start/Reset';

            % Create InputDropDown
            comp.InputDropDown = uidropdown(comp.GridLayout);
            comp.InputDropDown.Items = {''};
            comp.InputDropDown.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @InputDropDownValueChanged, true);
            comp.InputDropDown.Enable = 'off';
            comp.InputDropDown.Layout.Row = 2;
            comp.InputDropDown.Layout.Column = 4;
            comp.InputDropDown.Value = '';

            % Create TextArea
            comp.TextArea = uitextarea(comp.GridLayout);
            comp.TextArea.Editable = 'off';
            comp.TextArea.Visible = 'off';
            comp.TextArea.Layout.Row = 7;
            comp.TextArea.Layout.Column = [3 4];

            % Create Lamp
            comp.Lamp = uilamp(comp.GridLayout);
            comp.Lamp.Visible = 'off';
            comp.Lamp.Layout.Row = 7;
            comp.Lamp.Layout.Column = 6;
            comp.Lamp.Color = [1 0 0];

            % Create HowtoUseButton
            comp.HowtoUseButton = uibutton(comp.GridLayout, 'push');
            comp.HowtoUseButton.ButtonPushedFcn = matlab.apps.createCallbackFcn(comp, @HowtoUseButtonPushed, true);
            comp.HowtoUseButton.Layout.Row = 2;
            comp.HowtoUseButton.Layout.Column = [5 6];
            comp.HowtoUseButton.Text = 'How to Use';

            % Create TuningLabel
            comp.TuningLabel = uilabel(comp.GridLayout);
            comp.TuningLabel.HorizontalAlignment = 'right';
            comp.TuningLabel.Visible = 'off';
            comp.TuningLabel.Layout.Row = 7;
            comp.TuningLabel.Layout.Column = 5;
            comp.TuningLabel.Text = 'Tuning:';

            % Create InputLabel
            comp.InputLabel = uilabel(comp.GridLayout);
            comp.InputLabel.HorizontalAlignment = 'right';
            comp.InputLabel.Layout.Row = 2;
            comp.InputLabel.Layout.Column = 3;
            comp.InputLabel.Text = 'Input:';

            % Create Button1
            comp.Button1 = uibutton(comp.GridLayout, 'state');
            comp.Button1.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @Button1ValueChanged, true);
            comp.Button1.Visible = 'off';
            comp.Button1.Text = 'Button1';
            comp.Button1.Layout.Row = 4;
            comp.Button1.Layout.Column = [1 2];

            % Create Button2
            comp.Button2 = uibutton(comp.GridLayout, 'state');
            comp.Button2.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @Button2ValueChanged, true);
            comp.Button2.Visible = 'off';
            comp.Button2.Text = 'Button2';
            comp.Button2.Layout.Row = 5;
            comp.Button2.Layout.Column = [1 2];

            % Create Button3
            comp.Button3 = uibutton(comp.GridLayout, 'state');
            comp.Button3.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @Button3ValueChanged, true);
            comp.Button3.Visible = 'off';
            comp.Button3.Text = 'Button3';
            comp.Button3.Layout.Row = 6;
            comp.Button3.Layout.Column = [1 2];

            % Create Button4
            comp.Button4 = uibutton(comp.GridLayout, 'state');
            comp.Button4.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @Button4ValueChanged, true);
            comp.Button4.Visible = 'off';
            comp.Button4.Text = 'Button4';
            comp.Button4.Layout.Row = 4;
            comp.Button4.Layout.Column = [5 6];

            % Create Button5
            comp.Button5 = uibutton(comp.GridLayout, 'state');
            comp.Button5.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @Button5ValueChanged, true);
            comp.Button5.Visible = 'off';
            comp.Button5.Text = 'Button5';
            comp.Button5.Layout.Row = 5;
            comp.Button5.Layout.Column = [5 6];

            % Create Button6
            comp.Button6 = uibutton(comp.GridLayout, 'state');
            comp.Button6.ValueChangedFcn = matlab.apps.createCallbackFcn(comp, @Button6ValueChanged, true);
            comp.Button6.Visible = 'off';
            comp.Button6.Text = 'Button6';
            comp.Button6.Layout.Row = 6;
            comp.Button6.Layout.Column = [5 6];
        end
    end
end