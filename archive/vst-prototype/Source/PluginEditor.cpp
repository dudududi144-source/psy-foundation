/*
  =============================================================================
  PSY4 Plugin Editor — UI implementation
  =============================================================================

  Phase 4 Day 1: minimal but functional editor.
  =============================================================================

  SPDX-License-Identifier: MIT
*/

#include "PluginEditor.h"
#include "PluginProcessor.h"

namespace psy4 {

PluginEditor::PluginEditor(PluginProcessor& p)
    : juce::AudioProcessorEditor(&p), processorRef(p)
{
    // Title
    titleLabel.setText("PSY4 — Psytrance Synth", juce::dontSendNotification);
    titleLabel.setColour(juce::Label::textColourId, juce::Colour(0xFF, 0xE0, 0x00));
    titleLabel.setFont(juce::Font(18.0f, juce::Font::bold));
    titleLabel.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(titleLabel);

    // Cutoff slider
    cutoffLabel.setText("Cutoff", juce::dontSendNotification);
    cutoffLabel.setColour(juce::Label::textColourId, juce::Colour(0xCC, 0xCC, 0xCC));
    addAndMakeVisible(cutoffLabel);

    cutoffSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    cutoffSlider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 80, 20);
    cutoffSlider.setColour(juce::Slider::textBoxTextColourId, juce::Colour(0xFF, 0xFF, 0xFF));
    cutoffSlider.setColour(juce::Slider::textBoxBackgroundColourId, juce::Colour(0x33, 0x33, 0x33));
    addAndMakeVisible(cutoffSlider);
    cutoffAttachment = std::make_unique<SliderAttachment>(
        processorRef.parameters, PluginProcessor::PARAM_CUTOFF, cutoffSlider);

    // Resonance slider
    resonanceLabel.setText("Resonance", juce::dontSendNotification);
    resonanceLabel.setColour(juce::Label::textColourId, juce::Colour(0xCC, 0xCC, 0xCC));
    addAndMakeVisible(resonanceLabel);

    resonanceSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    resonanceSlider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 80, 20);
    resonanceSlider.setColour(juce::Slider::textBoxTextColourId, juce::Colour(0xFF, 0xFF, 0xFF));
    resonanceSlider.setColour(juce::Slider::textBoxBackgroundColourId, juce::Colour(0x33, 0x33, 0x33));
    addAndMakeVisible(resonanceSlider);
    resonanceAttachment = std::make_unique<SliderAttachment>(
        processorRef.parameters, PluginProcessor::PARAM_RESONANCE, resonanceSlider);

    // Master gain slider
    gainLabel.setText("Master", juce::dontSendNotification);
    gainLabel.setColour(juce::Label::textColourId, juce::Colour(0xCC, 0xCC, 0xCC));
    addAndMakeVisible(gainLabel);

    masterGainSlider.setSliderStyle(juce::Slider::LinearHorizontal);
    masterGainSlider.setTextBoxStyle(juce::Slider::TextBoxRight, false, 80, 20);
    masterGainSlider.setColour(juce::Slider::textBoxTextColourId, juce::Colour(0xFF, 0xFF, 0xFF));
    masterGainSlider.setColour(juce::Slider::textBoxBackgroundColourId, juce::Colour(0x33, 0x33, 0x33));
    addAndMakeVisible(masterGainSlider);
    // Note: master gain is not a parameter — it's internal.
    // For now, just use it as a UI display. Phase 4 Day 2 will add it as a parameter.

    // Status label
    statusLabel.setText("Click keyboard to play | MIDI input supported", juce::dontSendNotification);
    statusLabel.setColour(juce::Label::textColourId, juce::Colour(0x99, 0x99, 0x99));
    statusLabel.setFont(juce::Font(11.0f));
    statusLabel.setJustificationType(juce::Justification::centred);
    addAndMakeVisible(statusLabel);

    // Set window size
    setSize(500, 300);
}

PluginEditor::~PluginEditor()
{
}

//==============================================================================
void PluginEditor::paint(juce::Graphics& g)
{
    // Background — dark gradient (matches PSY Foundation design)
    juce::ColourGradient grad(
        juce::Colour(0x23, 0x26, 0x2D), 0, 0,
        juce::Colour(0x0F, 0x11, 0x16), 0, getHeight(), false);
    g.setGradientFill(grad);
    g.fillAll();

    // Draw virtual keyboard
    drawKeyboard(g);
}

void PluginEditor::resized()
{
    auto area = getLocalBounds();

    // Title at top
    titleLabel.setBounds(area.removeFromTop(30));

    // Sliders in middle
    auto sliderArea = area.removeFromTop(120);
    auto cutoffArea = sliderArea.removeFromTop(30);
    cutoffLabel.setBounds(cutoffArea.removeFromLeft(70));
    cutoffSlider.setBounds(cutoffArea);

    auto resArea = sliderArea.removeFromTop(30);
    resonanceLabel.setBounds(resArea.removeFromLeft(70));
    resonanceSlider.setBounds(resArea);

    auto gainArea = sliderArea.removeFromTop(30);
    gainLabel.setBounds(gainArea.removeFromLeft(70));
    masterGainSlider.setBounds(gainArea);

    // Keyboard at bottom
    auto kbArea = area.removeFromTop(80);
    // Calculate keyboard key bounds
    auto kbWidth = static_cast<float>(kbArea.getWidth());
    auto kbHeight = static_cast<float>(kbArea.getHeight());
    auto whiteKeyWidth = kbWidth / 7.0f; // 7 white keys per octave
    auto blackKeyWidth = whiteKeyWidth * 0.6f;
    auto blackKeyHeight = kbHeight * 0.6f;

    // White keys: C, D, E, F, G, A, B (indices 0, 2, 4, 5, 7, 9, 11)
    const int whiteKeyIndices[] = {0, 2, 4, 5, 7, 9, 11};
    for (int i = 0; i < 7; i++) {
        int idx = whiteKeyIndices[i];
        keyBounds[idx] = juce::Rectangle<float>(
            i * whiteKeyWidth, 0, whiteKeyWidth, kbHeight);
    }

    // Black keys: C#, D#, F#, G#, A# (indices 1, 3, 6, 8, 10)
    const int blackKeyIndices[] = {1, 3, 6, 8, 10};
    const float blackKeyOffsets[] = {0.7f, 1.7f, 3.7f, 4.7f, 5.7f};
    for (int i = 0; i < 5; i++) {
        int idx = blackKeyIndices[i];
        keyBounds[idx] = juce::Rectangle<float>(
            blackKeyOffsets[i] * whiteKeyWidth, 0,
            blackKeyWidth, blackKeyHeight);
    }

    // Status at bottom
    statusLabel.setBounds(area);
}

//==============================================================================
void PluginEditor::drawKeyboard(juce::Graphics& g)
{
    // Draw white keys
    const int whiteKeyIndices[] = {0, 2, 4, 5, 7, 9, 11};
    for (int i = 0; i < 7; i++) {
        int idx = whiteKeyIndices[i];
        auto& rect = keyBounds[idx];
        g.setColour(juce::Colour(0xE0, 0xE0, 0xE0));
        g.fillRect(rect);
        g.setColour(juce::Colour(0x99, 0x99, 0x99));
        g.drawRect(rect, 1.0f);
    }

    // Draw black keys
    const int blackKeyIndices[] = {1, 3, 6, 8, 10};
    for (int i = 0; i < 5; i++) {
        int idx = blackKeyIndices[i];
        auto& rect = keyBounds[idx];
        g.setColour(juce::Colour(0x33, 0x33, 0x33));
        g.fillRect(rect);
        g.setColour(juce::Colour(0x66, 0x66, 0x66));
        g.drawRect(rect, 1.0f);
    }

    // Highlight current note
    if (currentNote >= 0) {
        int keyIdx = currentNote - BASE_MIDI;
        if (keyIdx >= 0 && keyIdx < NUM_KEYS) {
            auto& rect = keyBounds[keyIdx];
            g.setColour(juce::Colour(0xFF, 0xE0, 0x00).withAlpha(0.5f));
            g.fillRect(rect);
        }
    }
}

//==============================================================================
int PluginEditor::getKeyAtPosition(juce::Point<int> pos)
{
    // Check black keys first (they're on top)
    const int blackKeyIndices[] = {1, 3, 6, 8, 10};
    for (int i = 0; i < 5; i++) {
        int idx = blackKeyIndices[i];
        if (keyBounds[idx].contains(pos.toFloat())) {
            return BASE_MIDI + idx;
        }
    }
    // Then white keys
    const int whiteKeyIndices[] = {0, 2, 4, 5, 7, 9, 11};
    for (int i = 0; i < 7; i++) {
        int idx = whiteKeyIndices[i];
        if (keyBounds[idx].contains(pos.toFloat())) {
            return BASE_MIDI + idx;
        }
    }
    return -1;
}

void PluginEditor::mouseDown(const juce::MouseEvent& e)
{
    int note = getKeyAtPosition(e.getPosition());
    if (note >= 0) {
        triggerNote(note);
    }
}

void PluginEditor::mouseUp(const juce::MouseEvent& e)
{
    if (currentNote >= 0) {
        releaseNote(currentNote);
    }
}

void PluginEditor::triggerNote(int midiNote)
{
    if (currentNote >= 0) {
        releaseNote(currentNote);
    }
    currentNote = midiNote;
    processorRef.noteOn(midiNote, 0.8f);
    repaint();
}

void PluginEditor::releaseNote(int midiNote)
{
    processorRef.noteOff(midiNote);
    currentNote = -1;
    repaint();
}

} // namespace psy4
