//! Draws the extension icons.
//!
//! A keycap bearing the command glyph. The extension is entirely about which
//! application gets a Cmd chord, so the chord itself is the subject.
//!
//! Everything is drawn at eight times the final size and reduced with a
//! Lanczos filter. Drawing straight to 16x16 leaves the glyph's strokes
//! landing between pixels however good the rasteriser's anti-aliasing is;
//! supersampling puts that decision in the resampler, which is better at it.
//!
//! Every shape is geometry rather than a font, so the output is identical on
//! any machine instead of depending on what happens to be installed.
//!
//!     cargo run --release --manifest-path tools/icons/Cargo.toml

use image::imageops::FilterType;
use image::{ImageBuffer, Rgba, RgbaImage};
use std::path::{Path, PathBuf};
use tiny_skia::{
    Color, FillRule, LineCap, LineJoin, Paint, PathBuilder, Pixmap, Rect, Stroke, Transform,
};

/// Supersample factor. Eight is where the 16px glyph stops shimmering.
const SS: u32 = 8;

/// Colours as bytes, because Color::from_rgba8 is not a const fn.
const ACCENT: [u8; 3] = [43, 108, 246];
const ACCENT_DEEP: [u8; 3] = [28, 78, 194];
const GLYPH: [u8; 3] = [255, 255, 255];

fn rgb(c: [u8; 3]) -> Color {
    Color::from_rgba8(c[0], c[1], c[2], 255)
}

/// Control-point ratio that turns four cubics into a circle, to within a
/// thousandth of the radius. There is no exact cubic circle, and this is the
/// error-minimising constant everyone uses.
const KAPPA: f32 = 0.5522847;

/// Proportions per size, as fractions of the icon's width.
///
/// One set does not survive the range. At 128px the glyph can be fine and the
/// cap can carry a front edge; at 16px both turn to mush, so the small icon
/// gets thicker strokes, a larger glyph and a flat cap. Designing the small
/// size separately is the normal answer here rather than a compromise: the
/// toolbar icon is the one anybody actually looks at.
struct Proportions {
    size: u32,
    side: f32,
    loop_r: f32,
    stroke: f32,
    front_edge: bool,
}

// Radii and side lengths are centrelines, since a stroke here is centred on
// its path rather than drawn inside it: the shape a reader sees is `side`
// plus one stroke width across, and `loop_r` plus half a stroke in radius.
const SIZES: [Proportions; 3] = [
    Proportions {
        size: 16,
        side: 0.310,
        loop_r: 0.100,
        stroke: 0.090,
        front_edge: false,
    },
    Proportions {
        size: 48,
        side: 0.276,
        loop_r: 0.091,
        stroke: 0.074,
        front_edge: true,
    },
    Proportions {
        size: 128,
        side: 0.270,
        loop_r: 0.089,
        stroke: 0.070,
        front_edge: true,
    },
];

/// Append a rounded rectangle to `pb`, corners as cubic approximations of arcs.
fn rounded_rect(pb: &mut PathBuilder, x: f32, y: f32, w: f32, h: f32, r: f32) {
    let r = r.min(w / 2.0).min(h / 2.0);
    let c = r * KAPPA;
    let (x1, y1) = (x + w, y + h);

    pb.move_to(x + r, y);
    pb.line_to(x1 - r, y);
    pb.cubic_to(x1 - r + c, y, x1, y + r - c, x1, y + r);
    pb.line_to(x1, y1 - r);
    pb.cubic_to(x1, y1 - r + c, x1 - r + c, y1, x1 - r, y1);
    pb.line_to(x + r, y1);
    pb.cubic_to(x + r - c, y1, x, y1 - r + c, x, y1 - r);
    pb.line_to(x, y + r);
    pb.cubic_to(x, y + r - c, x + r - c, y, x + r, y);
    pb.close();
}

fn fill(pixmap: &mut Pixmap, path: &tiny_skia::Path, color: [u8; 3]) {
    let mut paint = Paint::default();
    paint.set_color(rgb(color));
    paint.anti_alias = true;
    pixmap.fill_path(path, &paint, FillRule::Winding, Transform::identity(), None);
}

fn stroke(pixmap: &mut Pixmap, path: &tiny_skia::Path, color: [u8; 3], width: f32) {
    let mut paint = Paint::default();
    paint.set_color(rgb(color));
    paint.anti_alias = true;
    let opts = Stroke {
        width,
        line_cap: LineCap::Round,
        line_join: LineJoin::Round,
        ..Stroke::default()
    };
    pixmap.stroke_path(path, &paint, &opts, Transform::identity(), None);
}

/// One icon, drawn large and returned at its final size.
fn keycap(p: &Proportions) -> RgbaImage {
    let s = (p.size * SS) as f32;
    let mut pixmap =
        Pixmap::new(p.size * SS, p.size * SS).expect("icon dimensions are non-zero constants");

    // The cap. A darker rounded rect behind a lighter one reads as a key's
    // front edge without needing a gradient or a shadow.
    let pad = s * 0.055;
    let radius = s * 0.235;
    let mut pb = PathBuilder::new();
    rounded_rect(&mut pb, pad, pad, s - 2.0 * pad, s - 2.0 * pad, radius);
    fill(
        &mut pixmap,
        &pb.finish()
            .expect("the cap outline is closed and non-empty"),
        ACCENT_DEEP,
    );

    let face_h = s - 2.0 * pad - if p.front_edge { s * 0.055 } else { 0.0 };
    let mut pb = PathBuilder::new();
    rounded_rect(&mut pb, pad, pad, s - 2.0 * pad, face_h, radius);
    fill(
        &mut pixmap,
        &pb.finish()
            .expect("the cap face outline is closed and non-empty"),
        ACCENT,
    );

    // The command glyph. U+2318 is a square with a loop at each corner, and
    // building it from primitives keeps the output identical everywhere.
    //
    // The loops sit exactly on the square's corners, so the sides run between
    // loop centres and read as passing through them, which is how the real
    // glyph interlocks. The loop radius has to stay well under half the side
    // length or adjacent loops merge into a blob once the icon is reduced.
    let a = s * p.side;
    let rr = s * p.loop_r;
    let w = s * p.stroke;
    let c = s / 2.0 - if p.front_edge { s * 0.022 } else { 0.0 };

    for &sx in &[-1.0f32, 1.0] {
        for &sy in &[-1.0f32, 1.0] {
            let (ox, oy) = (c + sx * a / 2.0, c + sy * a / 2.0);
            let mut pb = PathBuilder::new();
            pb.push_oval(
                Rect::from_ltrb(ox - rr, oy - rr, ox + rr, oy + rr)
                    .expect("loop radius is positive, so the bounds are valid"),
            );
            stroke(
                &mut pixmap,
                &pb.finish().expect("an oval is always a usable path"),
                GLYPH,
                w,
            );
        }
    }
    let mut pb = PathBuilder::new();
    pb.push_rect(
        Rect::from_ltrb(c - a / 2.0, c - a / 2.0, c + a / 2.0, c + a / 2.0)
            .expect("side length is positive, so the bounds are valid"),
    );
    stroke(
        &mut pixmap,
        &pb.finish().expect("a rectangle is always a usable path"),
        GLYPH,
        w,
    );

    // tiny-skia stores premultiplied alpha; PNG wants it straight.
    let side = p.size * SS;
    let mut buf: RgbaImage = ImageBuffer::new(side, side);
    for (i, px) in pixmap.pixels().iter().enumerate() {
        let c = px.demultiply();
        buf.put_pixel(
            i as u32 % side,
            i as u32 / side,
            Rgba([c.red(), c.green(), c.blue(), c.alpha()]),
        );
    }
    image::imageops::resize(&buf, p.size, p.size, FilterType::Lanczos3)
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    // The crate lives at tools/icons, so the repository root is two up. Going
    // via CARGO_MANIFEST_DIR rather than the working directory means the same
    // command works from anywhere in the tree.
    let root: PathBuf = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .ok_or("cannot locate repository root")?
        .to_path_buf();
    let out = root.join("icons");
    std::fs::create_dir_all(&out)?;

    for p in &SIZES {
        let path = out.join(format!("icon{}.png", p.size));
        keycap(p).save(&path)?;
        println!(
            "wrote icons/icon{}.png ({} bytes)",
            p.size,
            std::fs::metadata(&path)?.len()
        );
    }
    Ok(())
}
