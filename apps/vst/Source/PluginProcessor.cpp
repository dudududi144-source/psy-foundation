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
// Phase E: now with per-voice pan and noteOff support
class LeadVoice {
public:
    LeadVoice() : freq(440.0f), cutoff(3000.0f), res(0.3f), gain(0.6f), active(false),
                  pan(0.0f), gainL(0.707f), gainR(0.707f) {}

    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        saw.reset();
        filter.reset();
        env.setDecay(0.3f);
        env.trigger(velocity);
        active = true;
    }

    void noteOff() { active = false; }

    // Phase E: process returns stereo [L, R]
    void process(float sr, float& outL, float& outR) {
        if (!active) { outL = 0.0f; outR = 0.0f; return; }
        float e = env.process(sr);
        if (e < 0.001f) { active = false; outL = 0.0f; outR = 0.0f; return; }
        float s = saw.process(freq / sr);
        float f = filter.process(s, cutoff, res, sr);
        float sig = f * e * gain;
        outL = sig * gainL;
        outR = sig * gainR;
    }

    bool isActive() const { return active; }
    void setCutoff(float c) { cutoff = c; }
    void setResonance(float r) { res = r; }
    void setPan(float p) {
        pan = p;
        float angle = (p + 1.0f) * 0.25f * M_PI;
        gainL = std::cos(angle);
        gainR = std::sin(angle);
    }

private:
    BLSaw saw;
    ZDFSVF filter;
    DecayEnv env;
    float freq, cutoff, res, gain;
    float pan, gainL, gainR;
    bool active;
};

// ── Bass Voice ──
// Phase E: stereo + noteOff
class BassVoice {
public:
    BassVoice() : freq(82.0f), subPhase(0.0f), cutoff(800.0f), res(0.3f), gain(0.5f), active(false),
                  gainL(0.707f), gainR(0.707f) {}

    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        subPhase = 0.0f;
        saw.reset();
        filter.reset();
        env.setDecay(0.15f);
        env.trigger(velocity);
        active = true;
    }

    void noteOff() { active = false; }

    void process(float sr, float& outL, float& outR) {
        if (!active) { outL = 0.0f; outR = 0.0f; return; }
        float e = env.process(sr);
        if (e < 0.001f) { active = false; outL = 0.0f; outR = 0.0f; return; }
        subPhase += (2.0f * M_PI * freq) / sr;
        if (subPhase > 2.0f * M_PI) subPhase -= 2.0f * M_PI;
        float sub = std::sin(subPhase) * 0.5f;
        float sawOut = saw.process(freq / sr) * 0.5f;
        float f = filter.process(sub + sawOut, cutoff, res, sr);
        float sig = f * e * gain;
        outL = sig * gainL;
        outR = sig * gainR;
    }

    bool isActive() const { return active; }

private:
    BLSaw saw;
    ZDFSVF filter;
    DecayEnv env;
    float freq, subPhase, cutoff, res, gain;
    float gainL, gainR;
    bool active;
};

// ── Pad Voice ──
// Phase E: stereo + noteOff
class PadVoice {
public:
    PadVoice() : freq(220.0f), cutoff(600.0f), res(0.2f), gain(0.3f), active(false),
                 gainL(0.707f), gainR(0.707f) {}

    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        saw1.reset();
        saw2.reset();
        filter.reset();
        env.setDecay(0.8f);
        env.trigger(velocity * 0.5f);
        active = true;
    }

    void noteOff() { active = false; }

    void process(float sr, float& outL, float& outR) {
        if (!active) { outL = 0.0f; outR = 0.0f; return; }
        float e = env.process(sr);
        if (e < 0.001f) { active = false; outL = 0.0f; outR = 0.0f; return; }
        float s1 = saw1.process(freq / sr);
        float s2 = saw2.process(freq * 1.005f / sr);
        float f = filter.process((s1 + s2) * 0.5f, cutoff, res, sr);
        float sig = f * e * gain;
        outL = sig * gainL;
        outR = sig * gainR;
    }

    bool isActive() const { return active; }

private:
    BLSaw saw1, saw2;
    ZDFSVF filter;
    DecayEnv env;
    float freq, cutoff, res, gain;
    float gainL, gainR;
    bool active;
};

// ── Acid Voice (Phase E: 13th voice — TB-303 style) ──
class AcidVoice {
public:
    AcidVoice() : freq(220.0f), phase(0.0f), cutoff(500.0f), res(0.8f),
                  filterEnvAmount(2000.0f), gain(0.5f), active(false),
                  gainL(0.707f), gainR(0.707f) {}

    void noteOn(int midi, float velocity) {
        freq = 440.0f * std::pow(2.0f, (midi - 69) / 12.0f);
        phase = 0.0f;
        filter.reset();
        env.setDecay(0.3f);
        filterEnv.setDecay(0.2f);
        env.trigger(velocity);
        filterEnv.trigger(1.0f);
        active = true;
    }

    void noteOff() { active = false; }

    void process(float sr, float& outL, float& outR) {
        if (!active) { outL = 0.0f; outR = 0.0f; return; }
        float e = env.process(sr);
        if (e < 0.001f) { active = false; outL = 0.0f; outR = 0.0f; return; }
        float fe = filterEnv.process(sr);
        float dynamicCutoff = cutoff + fe * filterEnvAmount;
        // Square wave (naive — Phase F will add BLSquare to C++ headers)
        phase += freq / sr;
        if (phase >= 1.0f) phase -= 1.0f;
        float sq = (phase < 0.5f) ? 1.0f : -1.0f;
        float f = filter.process(sq, dynamicCutoff, res, sr);
        float sig = f * e * gain;
        outL = sig * gainL;
        outR = sig * gainR;
    }

    bool isActive() const { return active; }
    void setCutoff(float c) { cutoff = c; }
    void setResonance(float r) { res = r; }

private:
    ZDFSVF filter;
    DecayEnv env;
    DecayEnv filterEnv;
    float freq, phase, cutoff, res, filterEnvAmount, gain;
    float gainL, gainR;
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
    // Initialize voice types with real DSP
    for (auto& voice : leadVoices) {
        voice = std::make_unique<LeadVoice>();
        // Phase E: spread lead voices across stereo field
        static const float leadPans[] = {-0.6f, -0.3f, -0.1f, 0.1f, 0.3f, 0.5f, -0.4f, 0.6f};
        voice->setPan(leadPans[&voice - &leadVoices[0]]);
    }
    for (auto& voice : bassVoices)
        voice = std::make_unique<BassVoice>();
    for (auto& voice : padVoices)
        voice = std::make_unique<PadVoice>();
    acidVoice = std::make_unique<AcidVoice>(); // Phase E: 13th voice
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

    // Render all voices — Phase E: stereo + acidVoice + master chain
    float* channelL = buffer.getWritePointer(0);
    float* channelR = buffer.getWritePointer(1);

    for (int i = 0; i < buffer.getNumSamples(); i++)
    {
        // Phase E: stereo rendering with per-voice pan
        float mixL = 0.0f;
        float mixR = 0.0f;

        // Lead voices (8) with spread pan
        for (auto& voice : leadVoices) {
            if (voice->isActive()) {
                float vl, vr;
                voice->process(currentSampleRate, vl, vr);
                mixL += vl;
                mixR += vr;
            }
        }

        // Bass voices (2) — center
        for (auto& voice : bassVoices) {
            if (voice->isActive()) {
                float vl, vr;
                voice->process(currentSampleRate, vl, vr);
                mixL += vl;
                mixR += vr;
            }
        }

        // Pad voices (2) — wide
        for (auto& voice : padVoices) {
            if (voice->isActive()) {
                float vl, vr;
                voice->process(currentSampleRate, vl, vr);
                mixL += vl;
                mixR += vr;
            }
        }

        // Acid voice (1) — center
        if (acidVoice->isActive()) {
            float vl, vr;
            acidVoice->process(currentSampleRate, vl, vr);
            mixL += vl;
            mixR += vr;
        }

        // Master gain + soft saturation
        mixL *= 0.3f;
        mixR *= 0.3f;
        mixL = std::tanh(mixL * 1.2f) * 0.7f + mixL * 0.3f;
        mixR = std::tanh(mixR * 1.2f) * 0.7f + mixR * 0.3f;

        // M/S stereo widener
        float mid = (mixL + mixR) * 0.5f;
        float side = (mixL - mixR) * 0.5f * 1.3f;
        mixL = mid + side;
        mixR = mid - side;

        // Simple limiter (brickwall at 0.89 = -1dBTP)
        if (mixL > 0.89f) mixL = 0.89f;
        else if (mixL < -0.89f) mixL = -0.89f;
        if (mixR > 0.89f) mixR = 0.89f;
        else if (mixR < -0.89f) mixR = -0.89f;

        channelL[i] = mixL;
        channelR[i] = mixR;
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
    // Phase E: noteOff support for all voices
    (void)midiNote; // unused — all voices get noteOff
    for (auto& voice : leadVoices) voice->noteOff();
    for (auto& voice : bassVoices) voice->noteOff();
    for (auto& voice : padVoices) voice->noteOff();
    acidVoice->noteOff();
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
