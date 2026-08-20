/*
  =============================================================================
  PSY4 Plugin Processor — main DSP host for VST3/AU/LV2 plugin
  =============================================================================

  This is the C++ port of the TypeScript PSY4 engine.
  It shares the same DSP architecture (ZDF SVF, BL oscillators, modulation matrix)
  but is optimized for real-time plugin performance.

  The processor receives MIDI, runs the voice engines, and outputs stereo audio.
  Parameters are exposed to the DAW for automation.
*/

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <memory>

namespace psy4 {

// Forward declarations
class ZDFSVF;
class BLSaw;
class Wavetable;
class LeadVoice;
class BassVoice;
class KickVoice;
class MasterChain;
class ModulationMatrix;

//==============================================================================
class PluginProcessor : public juce::AudioProcessor
{
public:
    //==========================================================================
    PluginProcessor();
    ~PluginProcessor() override;

    //==========================================================================
    // AudioProcessor interface
    void prepareToPlay (double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout& layouts) const override;
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    //==========================================================================
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    //==========================================================================
    const juce::String getName() const override { return "PSY4"; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    //==========================================================================
    int getNumPrograms() override { return 11; }  // Factory presets
    int getCurrentProgram() override { return currentPreset; }
    void setCurrentProgram (int index) override;
    const juce::String getProgramName (int index) override;
    void changeProgramName (int, const juce::String&) override {}

    //==========================================================================
    void getStateInformation (juce::MemoryBlock& destData) override;
    void setStateInformation (const void* data, int sizeInBytes) override;

    //==========================================================================
    // PSY4-specific
    void noteOn (int midiNote, float velocity);
    void noteOff (int midiNote);
    void setParameter (const juce::String& name, float value);
    float getParameter (const juce::String& name) const;

    // Parameter IDs (shared with editor)
    static const juce::String PARAM_CUTOFF;
    static const juce::String PARAM_RESONANCE;
    static const juce::String PARAM_LEAD_GAIN;
    static const juce::String PARAM_BASS_GAIN;
    static const juce::String PARAM_HAT_GAIN;
    static const juce::String PARAM_STEREO_WIDTH;
    static const juce::String PARAM_TARGET_LUFS;
    static const juce::String PARAM_MACRO1;  // SPACE
    static const juce::String PARAM_MACRO2;  // ENERGY
    static const juce::String PARAM_MACRO3;  // TENSION

private:
    //==========================================================================
    // Voice engines — forward declarations (defined in .cpp)
    class LeadVoice;
    class BassVoice;
    class PadVoice;
    
    std::array<std::unique_ptr<LeadVoice>, 8> leadVoices;
    std::array<std::unique_ptr<BassVoice>, 2> bassVoices;
    std::array<std::unique_ptr<PadVoice>, 2> padVoices;
    int leadVoiceIndex = 0;
    int bassVoiceIndex = 0;
    int padVoiceIndex = 0;

    // Parameters (APVTS)
    juce::AudioProcessorValueTreeState parameters;

    // Preset management
    int currentPreset = 0;
    juce::StringArray presetNames = {
        "Full-On Kick", "Darkpsy Kick", "Rolling Bass", "Progressive Bass",
        "Full-On Lead", "Psychedelic Lead", "TB-303 Acid", "Dark Acid",
        "Atmosphere Pad", "Club Master", "Streaming Master"
    };

    // Current sample rate
    double currentSampleRate = 44100.0;

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR (PluginProcessor)
};

} // namespace psy4
