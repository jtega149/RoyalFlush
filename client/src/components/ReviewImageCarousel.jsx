import { useEffect, useState } from 'react';
import './ReviewImageCarousel.css';

export default function ReviewImageCarousel({ imageUrls = [], alt = 'Review upload' }) {
  const urls = imageUrls.filter(Boolean);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    setIndex(0);
  }, [urls.join('|')]);

  if (urls.length === 0) {
    return null;
  }

  if (urls.length === 1) {
    return (
      <div className="review-image-carousel">
        <img src={urls[0]} alt={alt} className="review-image" />
      </div>
    );
  }

  const goPrev = () => setIndex((current) => (current === 0 ? urls.length - 1 : current - 1));
  const goNext = () => setIndex((current) => (current === urls.length - 1 ? 0 : current + 1));

  return (
    <div className="review-image-carousel review-image-carousel--multi">
      <div className="review-image-carousel__viewport">
        <button
          type="button"
          className="review-image-carousel__arrow"
          onClick={goPrev}
          aria-label="Previous image"
        >
          ‹
        </button>
        <img
          src={urls[index]}
          alt={`${alt} ${index + 1} of ${urls.length}`}
          className="review-image"
        />
        <button
          type="button"
          className="review-image-carousel__arrow"
          onClick={goNext}
          aria-label="Next image"
        >
          ›
        </button>
      </div>
      <div className="review-image-carousel__dots" role="tablist" aria-label="Review images">
        {urls.map((url, dotIndex) => (
          <button
            key={url}
            type="button"
            role="tab"
            aria-selected={dotIndex === index}
            aria-label={`View image ${dotIndex + 1} of ${urls.length}`}
            className={dotIndex === index ? 'review-image-carousel__dot is-active' : 'review-image-carousel__dot'}
            onClick={() => setIndex(dotIndex)}
          />
        ))}
      </div>
    </div>
  );
}
