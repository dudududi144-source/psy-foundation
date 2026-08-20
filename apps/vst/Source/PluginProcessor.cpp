/*
  =============================================================================
  PSY4 Plugin Processor — DSP implementation with real ZDF SVF + BLSaw
  =============================================================================

  Port of the TypeScript PSY4 engine to C++ for VST3/AU/LV2 plugin format.
  Implements the core DSP: ZDF SVF, BLSaw, DecayEnv, and 3 voice types.
*/

#include "PluginProcessor.h"
#include "PluginEditor.h"
#include "DSP/ZDFSVF.h"
#include "DSP/BLSaw.h"
#include "DSP/DecayEnv.h"

namespace psy4 {

// Parameter IDs
const juce::String PluginProcessor::PARAM_CUTOFF = "cutoff";
const juce::String PluginProcessor::PARAM_RESONANCE = "resonance";
const juce::String PluginProcessor::PARAM_LEAD_GAIN = "leadGain";
const juce::String PluginProcessor::PARAM_BASS_GAIN = "bassGain";
const juce::String PluginProcessor::PARAM_HAT_GAIN = "hatGain";
const juce::String PluginProcessor::PARAM_STEREO_WIDTH = "stereoWidth";
const juce::String PluginProcessor::PARAM_TARGET_LUFS = "targetLufs";
const juce::String PluginProcessor::PARAM_MACRO1 = "macro1";
const juce::String PluginProcessor::PARAM_MACRO2 = "macro2";
const juce::String PluginProcessor::PARAM_MACRO3 = "macro3";

// ── Lead Voice ──
class LeadVoice {
public:
    LeadVoice() : freq(440.0f), cutoff(3000.0f), res(0.3f), gain(0.6f), active(false) {}
    
    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        saw.reset();
        filter.reset();
        env.setDecay(0.3f);
        env.trigger(velocity);
        active = true;
    }
    
    float process(float sr) {
        if (!active) return 0.0f;
        float e = env.process(sr);
        if (e < 0.001f) { active = false; return 0.0f; }
        float s = saw.process(freq / sr);
        float f = filter.process(s, cutoff, res, sr);
        return f * e * gain;
    }
    
    bool isActive() const { return active; }
    void setCutoff(float c) { cutoff = c; }
    void setResonance(float r) { res = r; }
    
private:
    BLSaw saw;
    ZDFSVF filter;
    DecayEnv env;
    float freq, cutoff, res, gain;
    bool active;
};

// ── Bass Voice ──
class BassVoice {
public:
    BassVoice() : freq(82.0f), subPhase(0.0f), cutoff(800.0f), res(0.3f), gain(0.5f), active(false) {}
    
    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        subPhase = 0.0f;
        saw.reset();
        filter.reset();
        env.setDecay(0.15f);
        env.trigger(velocity);
        active = true;
    }
    
    float process(float sr) {
        if (!active) return 0.0f;
        float e = env.process(sr);
        if (e < 0.001f) { active = false; return 0.0f; }
        subPhase += (2.0f * M_PI * freq) / sr;
        if (subPhase > 2.0f * M_PI) subPhase -= 2.0f * M_PI;
        float sub = std::sin(subPhase) * 0.5f;
        float sawOut = saw.process(freq / sr) * 0.5f;
        float f = filter.process(sub + sawOut, cutoff, res, sr);
        return f * e * gain;
    }
    
    bool isActive() const { return active; }
    
private:
    BLSaw saw;
    ZDFSVF filter;
    DecayEnv env;
    float freq, subPhase, cutoff, res, gain;
    bool active;
};

// ── Pad Voice ──
class PadVoice {
public:
    PadVoice() : freq(220.0f), cutoff(600.0f), res(0.2f), gain(0.3f), active(false) {}
    
    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        saw1.reset();
        saw2.reset();
        filter.reset();
        env.setDecay(0.8f);
        env.trigger(velocity * 0.5f);
        active = true;
    }
    
    float process(float sr) {
        if (!active) return 0.0f;
        float e = env.process(sr);
        if (e < 0.001f) { active = false; return 0.0f; }
        float s1 = saw1.process(freq / sr);
        float s2 = saw2.process(freq * 1.005f / sr); // detune
        float f = filter.process((s1 + s2) * 0.5f, cutoff, res, sr);
        return f * e * gain;
    }
    
    bool isActive() const { return active; }
    
private:
    BLSaw saw1, saw2;
    ZDFSVF filter;
    DecayEnv env;
    float freq, cutoff, res, gain;
    bool active;
};

//==============================================================================
PluginProcessor::PluginProcessor()
    : juce::AudioProcessor (BusesProperties()
        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
        .withOutput ("Output", juce::AudioChannelSet::stereo(), true)),
      parameters (*this, nullptr, "PSY4Params", juce::AudioProcessorValueTreeState::ParameterLayout
      {
          std::make_unique<juce::AudioParameterFloat>(PARAM_CUTOFF, "Cutoff",
              juce::NormalisableRange<float>(200.0f, 8000.0f, 1.0f, 0.3f), 3000.0f, "Hz"),
          std::make_unique<juce::AudioParameterFloat>(PARAM_RESONANCE, "Resonance",
              juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.3f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_LEAD_GAIN, "Lead Gain",
              juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.6f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_BASS_GAIN, "Bass Gain",
              juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.8f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_HAT_GAIN, "Hat Gain",
              juce::NormalisableRange<float>(0.0f, 2.0f, 0.01f), 0.85f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_STEREO_WIDTH, "Stereo Width",
              juce::NormalisableRange<float>(0.5f, 2.0f, 0.01f), 1.3f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_TARGET_LUFS, "Target LUFS",
              juce::NormalisableRange<float>(-18.0f, -6.0f, 0.1f), -11.0f, "dB"),
          std::make_unique<juce::AudioParameterFloat>(PARAM_MACRO1, "SPACE (Macro 1)",
              juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.5f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_MACRO2, "ENERGY (Macro 2)",
              juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.5f),
          std::make_unique<juce::AudioParameterFloat>(PARAM_MACRO3, "TENSION (Macro 3)",
              juce::NormalisableRange<float>(0.0f, 1.0f, 0.01f), 0.5f),
      })
{
    // Initialize 3 voice types with real DSP
    for (auto& voice : leadVoices)
        voice = std::make_unique<LeadVoice>();
    for (auto& voice : bassVoices)
        voice = std::make_unique<BassVoice>();
    for (auto& voice : padVoices)
        voice = std::make_unique<PadVoice>();
}

PluginProcessor::~PluginProcessor()
{
}

//==============================================================================
void PluginProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;
    // Voice engines don't need explicit prepare — ZDF SVF and BLSaw
    // compute coefficients per-sample from currentSampleRate.
}

bool PluginProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    if (layouts.getMainOutputChannelSet() != juce::AudioChannelSet::stereo())
        return false;
    return true;
}

void PluginProcessor::processBlock (juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midiMessages)
{
    juce::ScopedNoDenormals noDenormals;

    // Process MIDI messages
    for (const auto metadata : midiMessages)
    {
        const auto message = metadata.getMessage();
        if (message.isNoteOn())
        {
            int midi = message.getNoteNumber();
            float vel = message.getFloatVelocity();
            
            // Route by MIDI range: < 48 = bass, < 72 = lead, >= 72 = pad
            if (midi < 48) {
                bassVoices[bassVoiceIndex % 2]->noteOn(midi, vel);
                bassVoiceIndex++;
            } else if (midi >= 72) {
                padVoices[padVoiceIndex % 2]->noteOn(midi, vel);
                padVoiceIndex++;
            } else {
                leadVoices[leadVoiceIndex % 8]->noteOn(midi, vel);
                leadVoiceIndex++;
            }
        }
    }

    // Clear buffer
    buffer.clear();

    // Get parameter values
    float cutoff = parameters.getRawParameterValue(PARAM_CUTOFF)->load();
    float resonance = parameters.getRawParameterValue(PARAM_RESONANCE)->load();
    
    // Update voice parameters
    for (auto& voice : leadVoices) {
        voice->setCutoff(cutoff);
        voice->setResonance(resonance);
    }

    // Render all voices
    float* channelL = buffer.getWritePointer(0);
    float* channelR = buffer.getWritePointer(1);
    
    for (int i = 0; i < buffer.getNumSamples(); i++)
    {
        float sample = 0.0f;
        
        // Lead voices
        for (auto& voice : leadVoices)
            if (voice->isActive())
                sample += voice->process(currentSampleRate);
        
        // Bass voices
        for (auto& voice : bassVoices)
            if (voice->isActive())
                sample += voice->process(currentSampleRate);
        
        // Pad voices
        for (auto& voice : padVoices)
            if (voice->isActive())
                sample += voice->process(currentSampleRate);
        
        // Master gain + soft clip
        sample *= 0.3f;
        sample = std::tanh(sample); // soft saturation
        
        channelL[i] = sample;
        channelR[i] = sample;
    }
}

//==============================================================================
void PluginProcessor::noteOn (int midiNote, float velocity)
{
    if (midiNote < 48) {
        bassVoices[bassVoiceIndex % 2]->noteOn(midiNote, velocity);
        bassVoiceIndex++;
    } else if (midiNote >= 72) {
        padVoices[padVoiceIndex % 2]->noteOn(midiNote, velocity);
        padVoiceIndex++;
    } else {
        leadVoices[leadVoiceIndex % 8]->noteOn(midiNote, velocity);
        leadVoiceIndex++;
    }
}

void PluginProcessor::noteOff (int midiNote)
{
    // Voices use decay envelopes — noteOff is implicit when env < 0.001
}

//==============================================================================
void PluginProcessor::setCurrentProgram (int index)
{
    currentPreset = index;
    // Apply preset parameters
    switch (index) {
        case 0: // Full-On Kick
            parameters.getParameter(PARAM_CUTOFF)->setValueNotifyingHost(0.4f);
            break;
        case 4: // Full-On Lead
            parameters.getParameter(PARAM_CUTOFF)->setValueNotifyingHost(0.5f);
            parameters.getParameter(PARAM_LEAD_GAIN)->setValueNotifyingHost(0.6f);
            break;
        case 9: // Club Master
            parameters.getParameter(PARAM_TARGET_LUFS)->setValueNotifyingHost(0.4f);
            break;
        default: break;
    }
}

const juce::String PluginProcessor::getProgramName (int index)
{
    return presetNames[index];
}

//==============================================================================
void PluginProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    auto state = parameters.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void PluginProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    std::unique_ptr<juce::XmlElement> xmlState(getXmlFromBinary(data, sizeInBytes));
    if (xmlState != nullptr)
    {
        if (parameters.state.matchesXml(*xmlState))
            parameters.replaceState(juce::ValueTree::fromXml(*xmlState));
    }
}

//==============================================================================
juce::AudioProcessorEditor* PluginProcessor::createEditor()
{
    return new PluginEditor(*this);
}

//==============================================================================
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PluginProcessor();
}

} // namespace psy4
