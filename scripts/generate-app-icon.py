from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


PROJECT_DIRECTORY = Path(__file__).resolve().parent.parent
BUILD_DIRECTORY = PROJECT_DIRECTORY / "build"
CANVAS_SIZE = 1024


def load_font(size: int) -> ImageFont.FreeTypeFont:
    candidates = (
        Path("C:/Windows/Fonts/msyhbd.ttc"),
        Path("C:/Windows/Fonts/msyh.ttc"),
        Path("C:/Windows/Fonts/simhei.ttf"),
    )
    for candidate in candidates:
        if candidate.exists():
            return ImageFont.truetype(str(candidate), size)
    raise FileNotFoundError("A Windows font that supports the 原 character was not found.")


def main() -> None:
    BUILD_DIRECTORY.mkdir(parents=True, exist_ok=True)
    image = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)

    margin = 70
    draw.rounded_rectangle(
        (margin, margin, CANVAS_SIZE - margin, CANVAS_SIZE - margin),
        radius=250,
        fill="#2f493e",
    )
    draw.rounded_rectangle(
        (margin + 13, margin + 13, CANVAS_SIZE - margin - 13, CANVAS_SIZE - margin - 13),
        radius=237,
        outline="#466256",
        width=7,
    )

    font = load_font(545)
    character = "原"
    bounds = draw.textbbox((0, 0), character, font=font)
    width = bounds[2] - bounds[0]
    height = bounds[3] - bounds[1]
    position = (
        (CANVAS_SIZE - width) / 2 - bounds[0],
        (CANVAS_SIZE - height) / 2 - bounds[1] - 20,
    )
    draw.text(position, character, font=font, fill="#fffdf7")

    image.save(BUILD_DIRECTORY / "icon.png", optimize=True)
    image.save(
        BUILD_DIRECTORY / "icon.ico",
        format="ICO",
        sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
    )


if __name__ == "__main__":
    main()
