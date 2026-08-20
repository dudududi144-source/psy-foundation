# CMakeLists.txt — PSY4 VST3/AU/LV2 Plugin Build
#
# Build requirements:
#   - JUCE 7+ (set JUCE_PATH or use FetchContent)
#   - CMake 3.22+
#   - C++17 compiler
#
# Usage:
#   mkdir build && cd build
#   cmake .. -DCMAKE_BUILD_TYPE=Release
#   cmake --build .

cmake_minimum_required(VERSION 3.22)

project(PSY4 VERSION 8.9.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── JUCE ──
# Option 1: Use system JUCE
# set(JUCE_PATH /path/to/JUCE)
# list(APPEND CMAKE_MODULE_PATH ${JUCE_PATH}/extras/Build/CMake)

# Option 2: Fetch JUCE from GitHub (recommended)
include(FetchContent)
FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG 7.0.12
)
FetchContent_MakeAvailable(JUCE)

# ── Plugin Target ──
juce_add_plugin(PSY4
    COMPANY_NAME "PSY4"
    PLUGIN_MANUFACTURER_CODE Ps4y
    PLUGIN_CODE PSY4
    FORMATS VST3 AU Standalone LV2
    PRODUCT_NAME "PSY4"
    IS_SYNTH TRUE
    NEEDS_MIDI_INPUT TRUE
    NEEDS_MIDI_OUTPUT FALSE
    IS_MIDI_EFFECT FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE
)

# ── Sources ──
target_sources(PSY4
    PRIVATE
        Source/PluginProcessor.cpp
        Source/PluginEditor.cpp
)

target_include_directories(PSY4
    PRIVATE
        Source
        Source/DSP
)

# ── JUCE Modules ──
target_link_libraries(PSY4
    PRIVATE
        juce::juce_audio_utils
        juce::juce_dsp
        juce::juce_audio_processors
    PUBLIC
        juce::juce_recommended_config_flags
        juce::juce_recommended_lto_flags
        juce::juce_recommended_warning_flags
)

# ── Plugin Output Locations ──
# JUCE automatically copies to:
#   macOS:   ~/Library/Audio/Plug-Ins/VST3/ and ~/Library/Audio/Plug-Ins/Components/
#   Windows: C:/Program Files/Common Files/VST3/
#   Linux:   ~/.vst3/ and ~/.lv2/

# ── Install (for package managers) ──
if(APPLE)
    install(DIRECTORY ${CMAKE_BINARY_DIR}/PSY4_artefacts/Release/VST3/PSY4.vst3
            DESTINATION ~/Library/Audio/Plug-Ins/VST3)
    install(DIRECTORY ${CMAKE_BINARY_DIR}/PSY4_artefacts/Release/AU/PSY4.component
            DESTINATION ~/Library/Audio/Plug-Ins/Components)
elseif(WIN32)
    install(FILES ${CMAKE_BINARY_DIR}/PSY4_artefacts/Release/VST3/PSY4.vst3/Contents/x86_64-win/PSY4.vst3
            DESTINATION "C:/Program Files/Common Files/VST3")
else()
    install(DIRECTORY ${CMAKE_BINARY_DIR}/PSY4_artefacts/Release/VST3/PSY4.vst3
            DESTINATION ~/.vst3)
    install(DIRECTORY ${CMAKE_BINARY_DIR}/PSY4_artefacts/Release/LV2/PSY4.lv2
            DESTINATION ~/.lv2)
endif()
