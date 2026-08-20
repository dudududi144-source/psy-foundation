/*
  =============================================================================
  PSY4 Plugin Editor — UI for VST3/AU plugin
  =============================================================================

  Phase 4 Day 1: minimal but functional editor.
  - Virtual keyboard (1 octave)
  - Cutoff + Resonance sliders
  - Master gain slider
  - Status display

  This is the visual interface for the PSY4 plugin processor.
  =============================================================================

  SPDX-License-Identifier: MIT
*/

#pragma once

#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_audio_processors/juce_audio_processors.h>

namespace psy4 {

class PluginProcessor;

class PluginEditor : public juce::AudioProcessorEditor
{
public:
    explicit PluginEditor(PluginProcessor&);
    ~PluginEditor() override;

    //==========================================================================
    void paint(juce::Graphics&) override;
    void resized() override;

    //==========================================================================
    // Keyboard handler — mouse clicks trigger noteOn/noteOff
    void mouseDown(const juce::MouseEvent& e) override;
    void mouseUp(const juce::MouseEvent& e) override;

private:
    PluginProcessor& processorRef;

    // UI Components
    juce::Slider cutoffSlider;
    juce::Slider resonanceSlider;
    juce::Slider masterGainSlider;
    juce::Label titleLabel;
    juce::Label cutoffLabel;
    juce::Label resonanceLabel;
    juce::Label gainLabel;
    juce::Label statusLabel;

    // Keyboard layout (1 octave: C, C#, D, D#, E, F, F#, G, G#, A, A#, B)
    static constexpr int NUM_KEYS = 12;
    static constexpr int BASE_MIDI = 60; // C4
    juce::Rectangle<float> keyBounds[NUM_KEYS];

    // Current playing note (for mouse interaction)
    int currentNote = -1;

    // Attachments for parameter synchronization
    using SliderAttachment = juce::AudioProcessorValueTreeState::SliderAttachment;
    std::unique_ptr<SliderAttachment> cutoffAttachment;
    std::unique_ptr<SliderAttachment> resonanceAttachment;
    std::unique_ptr<SliderAttachment> masterGainAttachment;

    void drawKeyboard(juce::Graphics&);
    int getKeyAtPosition(juce::Point<int> pos);
    void triggerNote(int midiNote);
    void releaseNote(int midiNote);

    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(PluginEditor)
};

} // namespace psy4
