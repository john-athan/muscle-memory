//! Draws the extension icons.
//!
//! A keycap on a dark tile, its face showing a reload arrow: `⇧⌘R` means hard
//! reload, which is the chord Figma takes away and this extension gives back.
//! The chord itself sits in the corner as a small legend, the way real keycaps
//! print theirs, and is dropped at 16px where it would only be noise.
//!
//! The geometry is written on a 128 unit canvas, the same one as
//! `meta/icon.svg`, and scaled to each size. Everything is drawn at eight times
//! the final size and reduced with a Lanczos filter: drawing straight to 16x16
//! leaves strokes landing between pixels however good the anti-aliasing is.
//!
//! Every shape is geometry rather than a font, so the output is identical on
//! any machine instead of depending on what happens to be installed.
//!
//!     cargo run --release --manifest-path tools/icons/Cargo.toml

use image::imageops::FilterType;
use image::{ImageBuffer, Rgba, RgbaImage};
use std::path::{Path, PathBuf};
use tiny_skia::{
    Color, FillRule, GradientStop, LineCap, LineJoin, LinearGradient, Paint, PathBuilder, Pixmap,
    Point, Shader, SpreadMode, Stroke, Transform,
};

/// Supersample factor. Eight is where the 16px strokes stop shimmering.
const SS: u32 = 8;

/// The output sizes, as the manifest lists them.
const SIZES: [u32; 3] = [16, 48, 128];

const TILE_TOP: [u8; 3] = [0x2c, 0x2a, 0x36];
const TILE_BOTTOM: [u8; 3] = [0x1b, 0x1a, 0x22];
const CAP_SIDE: [u8; 3] = [0xa9, 0xa5, 0xb7];
const FACE_TOP: [u8; 3] = [0xfd, 0xfc, 0xf9];
const FACE_BOTTOM: [u8; 3] = [0xe6, 0xe2, 0xec];
const INK: [u8; 3] = [0x2c, 0x2a, 0x36];
const LEGEND: [u8; 3] = [0x7a, 0x75, 0x89];

/// Control-point ratio that turns four cubics into a circle, to within a
/// thousandth of the radius.
const KAPPA: f32 = 0.5522847;

fn rgba(c: [u8; 3], a: u8) -> Color {
    Color::from_rgba8(c[0], c[1], c[2], a)
}

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

/// Append a clockwise circular arc from `a0` to `a1` degrees (screen space,
/// y down), split into cubics of at most a quarter turn each.
fn arc(pb: &mut PathBuilder, cx: f32, cy: f32, r: f32, a0: f32, a1: f32) {
    let segments = ((a1 - a0) / 90.0).ceil().max(1.0) as usize;
    let step = (a1 - a0) / segments as f32;
    let at = |deg: f32| {
        let t = deg.to_radians();
        (cx + r * t.cos(), cy + r * t.sin())
    };
    let (sx, sy) = at(a0);
    pb.move_to(sx, sy);
    for i in 0..segments {
        let t0 = (a0 + step * i as f32).to_radians();
        let t1 = (a0 + step * (i + 1) as f32).to_radians();
        let k = 4.0 / 3.0 * ((t1 - t0) / 4.0).tan() * r;
        let (x0, y0) = (cx + r * t0.cos(), cy + r * t0.sin());
        let (x1, y1) = (cx + r * t1.cos(), cy + r * t1.sin());
        pb.cubic_to(
            x0 - k * t0.sin(),
            y0 + k * t0.cos(),
            x1 + k * t1.sin(),
            y1 - k * t1.cos(),
            x1,
            y1,
        );
    }
}

fn vertical(top: [u8; 3], bottom: [u8; 3], y0: f32, y1: f32) -> Shader<'static> {
    LinearGradient::new(
        Point::from_xy(0.0, y0),
        Point::from_xy(0.0, y1),
        vec![
            GradientStop::new(0.0, rgba(top, 255)),
            GradientStop::new(1.0, rgba(bottom, 255)),
        ],
        SpreadMode::Pad,
        Transform::identity(),
    )
    .expect("two distinct stops on a non-degenerate line make a gradient")
}

struct Canvas {
    pixmap: Pixmap,
    t: Transform,
}

impl Canvas {
    fn fill(&mut self, path: &tiny_skia::Path, shader: Shader<'static>) {
        let paint = Paint {
            shader,
            anti_alias: true,
            ..Paint::default()
        };
        self.pixmap
            .fill_path(path, &paint, FillRule::Winding, self.t, None);
    }

    fn stroke(&mut self, path: &tiny_skia::Path, color: [u8; 3], width: f32) {
        let mut paint = Paint::default();
        paint.set_color(rgba(color, 255));
        paint.anti_alias = true;
        let opts = Stroke {
            width,
            line_cap: LineCap::Round,
            line_join: LineJoin::Round,
            ..Stroke::default()
        };
        self.pixmap.stroke_path(path, &paint, &opts, self.t, None);
    }
}

fn rect_path(x: f32, y: f32, w: f32, h: f32, r: f32) -> tiny_skia::Path {
    let mut pb = PathBuilder::new();
    rounded_rect(&mut pb, x, y, w, h, r);
    pb.finish()
        .expect("a rounded rectangle is closed and non-empty")
}

/// One icon, drawn large and returned at its final size.
fn keycap(size: u32) -> RgbaImage {
    let side = size * SS;
    let mut c = Canvas {
        pixmap: Pixmap::new(side, side).expect("icon dimensions are non-zero constants"),
        t: Transform::from_scale(side as f32 / 128.0, side as f32 / 128.0),
    };

    // Tile, then the cap: shadow, side, face.
    c.fill(
        &rect_path(0.0, 0.0, 128.0, 128.0, 28.0),
        vertical(TILE_TOP, TILE_BOTTOM, 0.0, 128.0),
    );
    c.fill(
        &rect_path(20.0, 28.0, 88.0, 82.0, 20.0),
        Shader::SolidColor(rgba([0, 0, 0], 89)),
    );
    c.fill(
        &rect_path(20.0, 26.0, 88.0, 80.0, 20.0),
        Shader::SolidColor(rgba(CAP_SIDE, 255)),
    );
    c.fill(
        &rect_path(25.0, 20.0, 78.0, 74.0, 16.0),
        vertical(FACE_TOP, FACE_BOTTOM, 20.0, 94.0),
    );

    // The legend, ⇧ and ⌘, too small to read below 48px.
    if size >= 48 {
        let mut pb = PathBuilder::new();
        pb.move_to(38.0, 28.5);
        pb.line_to(42.5, 33.0);
        pb.line_to(40.2, 33.0);
        pb.line_to(40.2, 37.5);
        pb.line_to(35.8, 37.5);
        pb.line_to(35.8, 33.0);
        pb.line_to(33.5, 33.0);
        pb.close();
        pb.push_rect(tiny_skia::Rect::from_xywh(46.8, 30.8, 4.4, 4.4).expect("a positive square"));
        for (x, y) in [(45.6, 29.6), (52.4, 29.6), (45.6, 36.4), (52.4, 36.4)] {
            pb.push_circle(x, y, 1.2);
        }
        c.stroke(&pb.finish().expect("the legend is non-empty"), LEGEND, 1.2);
    }

    // The reload arrow: 300 degrees of arc, open at the top, and its head.
    let mut pb = PathBuilder::new();
    arc(&mut pb, 64.0, 62.0, 17.0, -60.0, 240.0);
    c.stroke(&pb.finish().expect("an arc is non-empty"), INK, 7.0);
    let mut pb = PathBuilder::new();
    pb.move_to(63.4, 42.8);
    pb.line_to(57.3, 54.4);
    pb.line_to(50.3, 42.2);
    pb.close();
    let head = pb.finish().expect("a triangle is non-empty");
    c.fill(&head, Shader::SolidColor(rgba(INK, 255)));
    c.stroke(&head, INK, 2.0);

    // tiny-skia stores premultiplied alpha; PNG wants it straight.
    let mut buf: RgbaImage = ImageBuffer::new(side, side);
    for (i, px) in c.pixmap.pixels().iter().enumerate() {
        let p = px.demultiply();
        buf.put_pixel(
            i as u32 % side,
            i as u32 / side,
            Rgba([p.red(), p.green(), p.blue(), p.alpha()]),
        );
    }
    image::imageops::resize(&buf, size, size, FilterType::Lanczos3)
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
    let out = root.join("src/icons");
    std::fs::create_dir_all(&out)?;

    for size in SIZES {
        let path = out.join(format!("icon{size}.png"));
        keycap(size).save(&path)?;
        println!(
            "wrote src/icons/icon{size}.png ({} bytes)",
            std::fs::metadata(&path)?.len()
        );
    }
    Ok(())
}
