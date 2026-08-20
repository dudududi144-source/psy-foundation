/*
  =============================================================================
  PSY4 Plugin Processor — main DSP host for VST3/AU plugin
  =============================================================================

  Phase A FIX: removed nested-class forward declarations that conflicted with
  namespace-scope voice classes defined in .cpp. Now voice classes are forward-
  declared at namespace scope and used consistently.

  SPDX-License-Identifier: MIT
*/

#pragma once

#include <juce_audio_processors/juce_audio_processors.h>
#include <array>
#include <memory>

namespace psy4 {

// Forward declarations at namespace scope (defined in .cpp)
class LeadVoice;
class BassVoice;
class PadVoice;

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
    int getNumPrograms() override { return 11; }
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

    // Parameter IDs (shared with editor)
    static const juce::String PARAM_CUTOFF;
    static const juce::String PARAM_RESONANCE;
    static const juce::String PARAM_LEAD_GAIN;
    static const juce::String PARAM_BASS_GAIN;
    static const juce::String PARAM_HAT_GAIN;
    static const juce::String PARAM_STEREO_WIDTH;
    static const juce::String PARAM_TARGET_LUFS;
    static const juce::String PARAM_MACRO1;
    static const juce::String PARAM_MACRO2;
    static const juce::String PARAM_MACRO3;

    // Phase A FIX: make parameters public so PluginEditor can access
    juce::AudioProcessorValueTreeState parameters;

private:
    // Phase A FIX: use namespace-scope forward declarations (not nested)
    std::array<std::unique_ptr<LeadVoice>, 8> leadVoices;
    std::array<std::unique_ptr<BassVoice>, 2> bassVoices;
    std::array<std::unique_ptr<PadVoice>, 2> padVoices;
    int leadVoiceIndex = 0;
    int bassVoiceIndex = 0;
    int padVoiceIndex = 0;

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
