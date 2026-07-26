import Foundation
import Vision
import ImageIO
import CoreGraphics

struct RecognizedLine: Codable {
    let text: String
    let confidence: Float
    let x: Double
    let y: Double
    let width: Double
    let height: Double
}

struct OCRResult: Codable {
    let lines: [RecognizedLine]
    let combinedText: String
}

guard CommandLine.arguments.count >= 2 else {
    FileHandle.standardError.write(Data("Usage: tcgbinder-vision-ocr <image-path>\n".utf8))
    exit(2)
}

let imageURL = URL(fileURLWithPath: CommandLine.arguments[1])
let request = VNRecognizeTextRequest()
request.recognitionLevel = .accurate
request.usesLanguageCorrection = true
request.recognitionLanguages = ["en-US"]
request.minimumTextHeight = 0.005

let handler = VNImageRequestHandler(url: imageURL, options: [:])
do {
    try handler.perform([request])
    let observations = request.results ?? []
    let lines: [RecognizedLine] = observations.compactMap { observation in
        guard let candidate = observation.topCandidates(1).first else { return nil }
        let box = observation.boundingBox
        return RecognizedLine(
            text: candidate.string,
            confidence: candidate.confidence,
            x: Double(box.origin.x),
            y: Double(box.origin.y),
            width: Double(box.size.width),
            height: Double(box.size.height)
        )
    }.sorted { left, right in
        if abs(left.y - right.y) > 0.01 { return left.y > right.y }
        return left.x < right.x
    }
    let output = OCRResult(lines: lines, combinedText: lines.map { $0.text }.joined(separator: "\n"))
    let data = try JSONEncoder().encode(output)
    FileHandle.standardOutput.write(data)
} catch {
    FileHandle.standardError.write(Data("Vision OCR failed: \(error.localizedDescription)\n".utf8))
    exit(1)
}
