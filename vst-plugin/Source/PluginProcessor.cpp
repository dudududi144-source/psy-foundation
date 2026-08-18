/*
  =============================================================================
  PSY4 Plugin Processor — DSP implementation
  =============================================================================

  Port of the TypeScript PSY4 engine to C++ for VST3/AU/LV2 plugin format.
  This is a scaffold — the actual DSP classes need to be implemented.
*/

#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace psy4 {

// Parameter IDs (shared with DAW automation)
const juce::String PluginProcessor::PARAM_CUTOFF = "cutoff";
const juce::String PluginProcessor::PARAM_RESONANCE = "resonance";
const juce::String PluginProcessor::PARAM_LEAD_GAIN = "leadGain";
const juce::String PluginProcessor::PARAM_BASS_GAIN = "bassGain";
const juce::String PluginProcessor::PARAM_HAT_GAIN = "hatGain";
const juce::String PluginProcessor::PARAM_STEREO_WIDTH = "stereoWidth";
const juce::String PluginProcessor::PARAM_TARGET_LUFS = "targetLufs";
const juce::String PluginProcessor::PARAM_MACRO1 = "macro1";  // SPACE
const juce::String PluginProcessor::PARAM_MACRO2 = "macro2";  // ENERGY
const juce::String PluginProcessor::PARAM_MACRO3 = "macro3";  // TENSION

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
              juce::NormalisableRange<float>(0.5f, 2.0f, 0.01f), 1.4f),
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
    // Initialize voice engines (scaffold — actual DSP classes TBD)
    // for (auto& voice : leadVoices)
    //     voice = std::make_unique<LeadVoice>();
    // for (auto& voice : bassVoices)
    //     voice = std::make_unique<BassVoice>();
    // for (auto& voice : kickVoices)
    //     voice = std::make_unique<KickVoice>();

    // modMatrix = std::make_unique<ModulationMatrix>();
    // masterChain = std::make_unique<MasterChain>();
}

PluginProcessor::~PluginProcessor()
{
}

//==============================================================================
void PluginProcessor::prepareToPlay (double sampleRate, int samplesPerBlock)
{
    currentSampleRate = sampleRate;

    // Initialize voice engines with sample rate
    // for (auto& voice : leadVoices) voice->prepare(sampleRate);
    // for (auto& voice : bassVoices) voice->prepare(sampleRate);
    // for (auto& voice : kickVoices) voice->prepare(sampleRate);
    // masterChain->prepare(sampleRate, samplesPerBlock);
}

bool PluginProcessor::isBusesLayoutSupported (const BusesLayout& layouts) const
{
    // Support stereo output
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
            noteOn(message.getNoteNumber(), message.getFloatVelocity());
        }
        else if (message.isNoteOff())
        {
            noteOff(message.getNoteNumber());
        }
    }

    // Clear buffer
    buffer.clear();

    // Render voices (scaffold — actual rendering TBD)
    // for (auto& voice : leadVoices) voice->render(buffer);
    // for (auto& voice : bassVoices) voice->render(buffer);
    // for (auto& voice : kickVoices) voice->render(buffer);

    // Apply master chain
    // masterChain->process(buffer);

    // Update modulation matrix
    // modMatrix->tick(buffer.getNumSamples());
}

//==============================================================================
void PluginProcessor::noteOn (int midiNote, float velocity)
{
    // Trigger next available lead voice
    // leadVoices[leadVoiceIndex]->noteOn(midiNote, velocity);
    // leadVoiceIndex = (leadVoiceIndex + 1) % leadVoices.size();
}

void PluginProcessor::noteOff (int midiNote)
{
    // Find voice playing this note and release it
    // for (auto& voice : leadVoices) voice->noteOff(midiNote);
}

void PluginProcessor::setParameter (const juce::String& name, float value)
{
    parameters.getParameter(name)->setValueNotifyingHost(value);
}

float PluginProcessor::getParameter (const juce::String& name) const
{
    return parameters.getParameter(name)->getValue();
}

//==============================================================================
void PluginProcessor::setCurrentProgram (int index)
{
    currentPreset = index;
    // Load preset parameters
    // TODO: implement preset loading
}

const juce::String PluginProcessor::getProgramName (int index)
{
    return presetNames[index];
}

//==============================================================================
void PluginProcessor::getStateInformation (juce::MemoryBlock& destData)
{
    // Save parameter state
    auto state = parameters.copyState();
    std::unique_ptr<juce::XmlElement> xml(state.createXml());
    copyXmlToBinary(*xml, destData);
}

void PluginProcessor::setStateInformation (const void* data, int sizeInBytes)
{
    // Load parameter state
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
// This creates new instances of the plugin
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new PluginProcessor();
}

} // namespace psy4
