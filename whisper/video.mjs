import path from 'path';
import fs from 'fs';
import { promisify } from 'util';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname } from 'path';
import { createRequire } from 'module';
import os from 'os';
import { execFileSync } from 'child_process';
import * as OpenCC from 'opencc-js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const require = createRequire(import.meta.url);

const engineDir = path.join(__dirname, "./engine");

let whisper;
let whisperAsync;

const isTruthy = (value) => {
    const normalized = String(value || '').trim().toLowerCase();
    return ["1", "true", "yes", "y", "on"].includes(normalized);
};

const forceCpu = isTruthy(process.env.XCAPTION_FORCE_CPU);

const hasCudaBackend = () => (
    fs.existsSync(path.join(engineDir, "ggml-cuda-whisper.dll")) ||
    fs.existsSync(path.join(engineDir, "ggml-cuda.dll"))
);

const hasVulkanBackend = () => (
    fs.existsSync(path.join(engineDir, "ggml-vulkan-whisper.dll")) ||
    fs.existsSync(path.join(engineDir, "ggml-vulkan.dll"))
);

const hasMetalBackend = () => (
    fs.existsSync(path.join(engineDir, "libggml-metal.dylib"))
);

const tryExec = (command, args) => {
    try {
        return execFileSync(command, args, {
            encoding: "utf8",
            stdio: ["ignore", "pipe", "ignore"]
        }).trim();
    } catch {
        return "";
    }
};

const hasNvidiaGpu = () => {
    const output = tryExec("nvidia-smi", ["--query-gpu=name", "--format=csv,noheader"]);
    return output.length > 0;
};

const hasAmdGpu = () => {
    if (os.platform() !== "win32") return false;
    let output = tryExec("wmic", ["path", "win32_VideoController", "get", "name", "/format:csv"]);
    if (!output) {
        output = tryExec("powershell", [
            "-NoProfile",
            "-Command",
            "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name"
        ]);
    }
    return output.split(/\r?\n/).some(line => /AMD|ATI|RADEON/i.test(line));
};

let gpuAvailabilityCache = null;

const detectGpuAvailability = () => {
    if (gpuAvailabilityCache) return gpuAvailabilityCache;

    if (forceCpu) {
        gpuAvailabilityCache = { useGpu: false, backend: "cpu" };
        return gpuAvailabilityCache;
    }

    const platform = os.platform();
    if (platform === "win32") {
        const useCuda = hasCudaBackend() && hasNvidiaGpu();
        const useVulkan = hasVulkanBackend() && hasAmdGpu();
        gpuAvailabilityCache = {
            useGpu: useCuda || useVulkan,
            backend: useCuda ? "cuda" : useVulkan ? "vulkan" : "cpu"
        };
        return gpuAvailabilityCache;
    }

    if (platform === "darwin") {
        const useMetal = os.arch() === "arm64" && hasMetalBackend();
        gpuAvailabilityCache = { useGpu: useMetal, backend: useMetal ? "metal" : "cpu" };
        return gpuAvailabilityCache;
    }

    gpuAvailabilityCache = { useGpu: false, backend: "cpu" };
    return gpuAvailabilityCache;
};

const shouldUseGpu = () => detectGpuAvailability().useGpu;

// Select addon based on platform and architecture
const getAddonPath = () => {
    const platform = os.platform();
    const arch = os.arch();
    
    let addonName;
    
    if (platform === 'win32' && arch === 'x64') {
        addonName = 'addon-win64.node';
    } else if (platform === 'darwin' && arch === 'arm64') {
        addonName = 'addon.node';
    } else {
        throw new Error(
            `Unsupported platform/architecture combination: ${platform}/${arch}\n` +
            `Supported combinations: win32/x64 (addon-win64.node), darwin/arm64 (addon.node)`
        );
    }
    
    const addonPath = path.join(engineDir, addonName);
    return addonPath;
};

try {
    const addonPath = getAddonPath();

    if (!fs.existsSync(addonPath)) {
        const availableAddons = fs.existsSync(engineDir)
            ? fs.readdirSync(engineDir).filter(f => f.endsWith('.node')).join(', ')
            : 'none';
        throw new Error(
            `Native addon not found.\n` +
            `Expected: addon.node\n` +
            `Path: ${addonPath}\n` +
            `Available addons: ${availableAddons || 'none'}\n` +
            `Please ensure addon.node exists in the engine directory.`
        );
    }

    // Note: DYLD_LIBRARY_PATH doesn't work with hardened runtime
    // The library paths are fixed during build using install_name_tool
    // to use @loader_path instead of @rpath, so libraries must be in the same
    // directory as addon.node (whisper/engine/)

    console.log(`Loading native addon from: ${addonPath}`);
    const addonModule = require(addonPath);
    whisper = addonModule.whisper || addonModule.default?.whisper || addonModule;

    if (!whisper || typeof whisper !== 'function') {
        throw new Error('Native addon loaded but whisper function not found or invalid');
    }

    whisperAsync = promisify(whisper);
    console.log(`Native addon loaded successfully`);
} catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorString = String(error).toLowerCase();

    // Check for macOS version incompatibility (libraries built for newer macOS)
    const isMacOSVersionError =
        errorMessage.includes('built for macOS') ||
        errorMessage.includes('newer than running OS') ||
        errorMessage.includes('Symbol not found') ||
        errorMessage.includes('MTLResidencySetDescriptor') ||
        errorMessage.includes('_OBJC_CLASS_$_');

    if (isMacOSVersionError) {
        const osVersion = os.release();
        const majorVersion = parseInt(osVersion.split('.')[0]);
        const macosVersion = majorVersion >= 20 ? `macOS ${majorVersion - 9}` : `macOS ${majorVersion + 4}`;

        throw new Error(
            `Failed to load native addon: macOS version incompatibility.\n` +
            `The native libraries were built for macOS 15.6 or newer, but your system is running ${macosVersion}.\n` +
            `Please update your macOS to version 15.6 or later, or use libraries compiled for your macOS version.\n` +
            `\nOriginal error: ${errorMessage}`
        );
    }

    // Check for missing library file errors (these are different from architecture errors)
    const isLibraryError =
        errorMessage.includes('Library not loaded') ||
        errorMessage.includes('libwhisper') ||
        errorMessage.includes('dylib');

    if (isLibraryError) {
        throw new Error(
            `Failed to load native addon: Missing or incompatible library dependencies.\n` +
            `Make sure all required .dylib files are in the same directory as the addon.\n` +
            `Original error: ${errorMessage}`
        );
    }

    throw new Error(`Failed to load native addon: ${errorMessage}`);
}

const formatTimeSRT = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = Math.floor(seconds % 60);
    const milliseconds = Math.floor((seconds % 1) * 1000);

    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')},${String(milliseconds).padStart(3, '0')}`;
};

const convertToSRT = (result) => {
    // Handle different possible result formats
    let segments = [];

    if (typeof result === 'string') {
        // If result is a string, try to parse it as JSON
        try {
            const parsed = JSON.parse(result);
            segments = parsed.segments || parsed.result || parsed.transcription || (Array.isArray(parsed) ? parsed : []);
        } catch (e) {
            // If not JSON, treat as plain text (no timestamps)
            return null;
        }
    } else if (Array.isArray(result)) {
        segments = result;
    } else if (result && result.segments) {
        segments = result.segments;
    } else if (result && result.result) {
        segments = result.result;
    } else if (result && result.transcription) {
        segments = result.transcription;
    } else {
        // Try to extract segments from object
        segments = Object.values(result).filter(item =>
            item && typeof item === 'object' && (item.start !== undefined || item.from !== undefined)
        );
    }

    if (!segments || segments.length === 0) {
        return null;
    }

    let srtContent = '';
    let index = 1;

    for (const segment of segments) {
        let start, end, text;

        if (Array.isArray(segment)) {
            // Handle [start, end, text] format
            [start, end, text] = segment;
        } else {
            start = segment.start !== undefined ? segment.start : segment.from;
            end = segment.end !== undefined ? segment.end : segment.to;
            text = segment.text || segment.text_segment || segment.content || '';
        }

        if (start !== undefined && end !== undefined && text) {
            srtContent += `${index}\n`;

            // Handle both numeric (seconds) and string timestamps
            const startTime = typeof start === 'number' ? formatTimeSRT(start) : String(start).replace('.', ',');
            const endTime = typeof end === 'number' ? formatTimeSRT(end) : String(end).replace('.', ',');

            srtContent += `${startTime} --> ${endTime}\n`;
            srtContent += `${text.trim()}\n\n`;
            index++;
        }
    }

    return srtContent.trim();
};

// NOTE: This function now expects a WAV file (16kHz, 16-bit, mono), NOT a video file.
// Audio extraction is handled in the main process.
const transcribeAudio = async (audioPath, options = {}) => {
    // Validate audio file exists
    if (!fs.existsSync(audioPath)) {
        throw new Error(`Audio file not found: ${audioPath}`);
    }

    try {
        // Wrap progress callback to check for cancellation
        const originalProgressCallback = options.progress_callback || ((progress) => {
            console.log(`Transcription progress: ${progress}%`);
        });

        const cancellationCheck = options.cancellationCheck || (() => false);

        // Use a flag to track cancellation instead of throwing from callback
        // Throwing from native callbacks can crash the addon
        let wasCancelled = false;

        const wrappedProgressCallback = (progress) => {
            // Check for cancellation but don't throw - just set flag
            // Native code doesn't handle exceptions from callbacks well
            if (cancellationCheck()) {
                wasCancelled = true;
                // Still call original callback to avoid breaking native code expectations
                // but we'll check the flag after transcription completes
                return;
            }
            originalProgressCallback(progress);
        };

        // Handle language selection
        let language = options.language || 'auto';
        let initial_prompt = options.prompt || '';

        if (language === 'zh_sim') {
            language = 'zh';
            initial_prompt = '以下是普通话的語音，請使用簡體中文字幕';
        } else if (language === 'zh_trad') {
            language = 'zh';
            initial_prompt = '以下是香港廣東話/台灣國語的語音，請使用繁體中文字幕';
        }

        console.log('Language:', language);
        console.log('Initial prompt:', initial_prompt);

        // Use model path from options if provided, otherwise fall back to local path
        const modelPath = options.model || path.join(__dirname, "./model.bin");
        console.log('Using model at:', modelPath);

        const useGpu = shouldUseGpu();
        console.log('GPU enabled:', useGpu ? 'yes' : 'no');

        // Prepare whisper parameters
        const whisperParams = {
            language: language,
            prompt: initial_prompt,
            model: modelPath,
            fname_inp: audioPath,
            use_gpu: useGpu,
            flash_attn: false,
            no_prints: true,
            comma_in_time: false,
            translate: false,
            no_timestamps: false,
            detect_language: false,
            audio_ctx: 0,
            max_len: 0,
            progress_callback: wrappedProgressCallback
        };

        // Transcribe audio
        console.log('Starting transcription...');
        let result;
        try {
            result = await whisperAsync(whisperParams);
        } catch (whisperError) {
            // Check if this is a corruption error
            const whisperErrorMessage = whisperError instanceof Error ? whisperError.message : String(whisperError);
            const whisperErrorString = String(whisperError).toLowerCase();
            const whisperErrorStack = whisperError instanceof Error ? whisperError.stack : '';
            const combinedWhisperError = `${whisperErrorMessage} ${whisperErrorStack} ${whisperErrorString}`.toLowerCase();

            // Check for corruption indicators
            const hasCorruptionMessage =
                combinedWhisperError.includes('not all tensors loaded') ||
                combinedWhisperError.includes('tensors loaded');

            const hasInitFailure =
                whisperErrorMessage.includes('failed to initialize whisper context') ||
                whisperErrorMessage.includes('failed to load model') ||
                combinedWhisperError.includes('failed to initialize');

            if (hasCorruptionMessage || hasInitFailure) {
                console.error('Model corruption or initialization failure detected in whisperAsync:', whisperErrorMessage);
                const corruptionError = new Error(
                    `MODEL_CORRUPTED: The model file is corrupted or failed to initialize. Error: ${whisperErrorMessage}\n` +
                    `Model path: ${options.model || 'default'}`
                );
                corruptionError.name = 'ModelCorruptionError';
                if (whisperError instanceof Error && whisperError.stack) {
                    corruptionError.stack = whisperError.stack;
                }
                throw corruptionError;
            }
            // Re-throw if not corruption
            throw whisperError;
        }

        // Check cancellation flag after transcription completes
        // This is safer than throwing from the callback
        if (wasCancelled || cancellationCheck()) {
            throw new Error('Transcription cancelled');
        }

        // Check if result is null/undefined - might indicate corruption
        if (!result) {
            console.error('whisperAsync returned null/undefined - this might indicate model corruption');
            throw new Error('MODEL_CORRUPTED: Transcription returned no result. The model file might be corrupted or failed to initialize.');
        }

        // Post-process Chinese text
        const targetLang = options.language;
        if (targetLang === 'zh_sim' || targetLang === 'zh_trad') {
            try {
                let segments = null;
                let parsedResult = result;

                // If result is string, parse it to modify segments
                if (typeof result === 'string') {
                    try {
                        parsedResult = JSON.parse(result);
                    } catch (e) {
                        // If parsing fails, we can't convert
                        parsedResult = null;
                    }
                }

                if (parsedResult) {
                    if (Array.isArray(parsedResult)) {
                        segments = parsedResult;
                    } else if (typeof parsedResult === 'object') {
                        if (Array.isArray(parsedResult.segments)) segments = parsedResult.segments;
                        else if (Array.isArray(parsedResult.result)) segments = parsedResult.result;
                        else if (Array.isArray(parsedResult.transcription)) segments = parsedResult.transcription;
                    }

                    if (segments && Array.isArray(segments)) {
                        // For Simplified: Convert from Traditional (HK) to Simplified (CN)
                        // For Traditional: Convert from Simplified (CN) to Traditional (TW)
                        const converter = OpenCC.Converter({
                            from: targetLang === 'zh_sim' ? 'hk' : 'cn',
                            to: targetLang === 'zh_sim' ? 'cn' : 'tw'
                        });

                        console.log(`Converting text to ${targetLang === 'zh_sim' ? 'Simplified' : 'Traditional'} Chinese...`);

                        for (const segment of segments) {
                            if (Array.isArray(segment) && segment.length >= 3) {
                                // Handle [start, end, text] format
                                segment[2] = converter(segment[2]);
                            } else if (segment && typeof segment === 'object') {
                                if (segment.text) segment.text = converter(segment.text);
                                if (segment.content) segment.content = converter(segment.content);
                                if (segment.text_segment) segment.text_segment = converter(segment.text_segment);
                            }
                        }

                        // If we parsed a string, return the object so the changes are preserved
                        if (typeof result === 'string') {
                            return parsedResult;
                        }
                    }
                }
            } catch (e) {
                console.error('Error converting Chinese text:', e);
            }
        }

        return result;
    } catch (error) {
        // Re-throw cancellation errors, but handle other errors gracefully
        if (error instanceof Error && error.message === 'Transcription cancelled') {
            throw error;
        }

        // Check for library loading errors (these can happen at runtime)
        const errorMessage = error instanceof Error ? error.message : String(error);
        const errorString = String(error).toLowerCase();

        // Check for macOS version incompatibility (libraries built for newer macOS)
        const isMacOSVersionError =
            errorMessage.includes('built for macOS') ||
            errorMessage.includes('newer than running OS') ||
            errorMessage.includes('Symbol not found') ||
            errorMessage.includes('MTLResidencySetDescriptor') ||
            errorMessage.includes('_OBJC_CLASS_$_');

        if (isMacOSVersionError) {
            const osVersion = os.release();
            const majorVersion = parseInt(osVersion.split('.')[0]);
            const macosVersion = majorVersion >= 20 ? `macOS ${majorVersion - 9}` : `macOS ${majorVersion + 4}`;

            throw new Error(
                `Transcription failed: macOS version incompatibility.\n` +
                `The native libraries were built for macOS 15.6 or newer, but your system is running ${macosVersion}.\n` +
                `Please update your macOS to version 15.6 or later, or use libraries compiled for your macOS version.\n` +
                `\nOriginal error: ${errorMessage}`
            );
        }

        // Check for missing library file errors
        const isLibraryError =
            errorMessage.includes('Library not loaded') ||
            errorMessage.includes('libwhisper') ||
            errorMessage.includes('dylib') ||
            errorString.includes('symbol not found') ||
            errorString.includes('module did not self-register');

        if (isLibraryError) {
            throw new Error(
                `Transcription failed: Missing or incompatible library dependencies.\n` +
                `Make sure all required .dylib files are in the same directory as the addon.\n` +
                `Original error: ${errorMessage}`
            );
        }

        // For other errors, enhance with context and re-throw
        console.error('Transcription error:', error);
        const errorStack = error instanceof Error ? error.stack : undefined;

        const enhancedError = new Error(
            `Transcription error: ${errorMessage}\n` +
            `Audio file: ${audioPath}\n` +
            `Model path: ${options.model || 'default'}\n` +
            (errorStack ? `\nStack trace:\n${errorStack}` : '')
        );
        if (error instanceof Error) {
            enhancedError.name = error.name;
            enhancedError.stack = errorStack;
        }
        throw enhancedError;
    }
};

export { transcribeAudio, convertToSRT };
