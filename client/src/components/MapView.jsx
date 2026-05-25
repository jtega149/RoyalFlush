import React, { useState, useEffect, useCallback } from 'react';
import {
  GoogleMap,
  Marker,
  Circle,
  InfoWindow,
  useJsApiLoader,
} from '@react-google-maps/api';
import bathroomIconUrl from '../assets/toliet_logo.png';
import './MapView.css';

const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY;
const LIBRARIES = ['places', 'geometry'];

const mapContainerStyle = { width: '100%', height: '100%' };

const mapOptions = {
  mapTypeControl: false,
  streetViewControl: false,
  fullscreenControl: true,
};

const defaultCenter = { lat: 40.7128, lng: -73.9352 };

function renderStars(averageRating) {
  const rounded = Math.round(Number(averageRating) || 0);
  return '★★★★★'.slice(0, rounded) + '☆☆☆☆☆'.slice(0, 5 - rounded);
}

export default function MapView({
  userLocation,
  onPlacesFound,
  visiblePlaceIds,
  locationIdByPlaceId,
  reviewSummaryByLocation,
  favoriteLocationIds,
  onLeaveReview,
  isLoggedIn,
  onRequireLogin,
  onToggleFavorite,
  favoriteLoadingId,
}) {
  const [places, setPlaces] = useState([]);
  const [selectedPlace, setSelectedPlace] = useState(null);
  const [map, setMap] = useState(null);
  const [showNoNearbyMessage, setShowNoNearbyMessage] = useState(false);
  const mapCenter = userLocation || defaultCenter;
  const shouldFilterVisiblePlaces = Array.isArray(visiblePlaceIds);
  const visiblePlaceIdSet = new Set(visiblePlaceIds || []);

  const { isLoaded, loadError } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: GOOGLE_MAPS_API_KEY || '',
    libraries: LIBRARIES,
  });

  const bathroomIcon = {
    url: bathroomIconUrl,
    scaledSize: isLoaded ? new window.google.maps.Size(36, 36) : undefined,
  };

  const runNearbySearch = useCallback(() => {
    if (!userLocation || !window.google?.maps?.places) return;

    setSelectedPlace(null);
    setPlaces([]);
    setShowNoNearbyMessage(false);

    const service = new window.google.maps.places.PlacesService(
      document.createElement('div')
    );

    service.nearbySearch(
      {
        location: userLocation,
        radius: 1500,
        keyword: 'public restroom',
      },
      (results, status) => {
        if (status === window.google.maps.places.PlacesServiceStatus.OK && results) {
          setPlaces(results);
          onPlacesFound?.(results);
          setShowNoNearbyMessage(false);
        } else if (status === window.google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          setPlaces([]);
          onPlacesFound?.([]);
          setShowNoNearbyMessage(true);
        } else {
          setPlaces([]);
          onPlacesFound?.([]);
          setShowNoNearbyMessage(false);
        }
      }
    );
  }, [onPlacesFound, userLocation]);

  useEffect(() => {
    if (!isLoaded || !userLocation) return undefined;
    const timer = setTimeout(() => {
      runNearbySearch();
    }, 0);
    return () => clearTimeout(timer);
  }, [isLoaded, runNearbySearch, userLocation]);

  useEffect(() => {
    if (!map || !userLocation || places.length === 0) return;

    const closestPlace = places.reduce((closest, place) => {
      const location = place.geometry?.location;
      if (!location) return closest;

      const latDiff = location.lat() - userLocation.lat;
      const lngDiff = location.lng() - userLocation.lng;
      const distanceScore = latDiff * latDiff + lngDiff * lngDiff;

      if (!closest || distanceScore < closest.distanceScore) {
        return {
          distanceScore,
          lat: location.lat(),
          lng: location.lng(),
        };
      }
      return closest;
    }, null);

    if (!closestPlace) return;

    const bounds = new window.google.maps.LatLngBounds();
    bounds.extend(userLocation);
    bounds.extend({ lat: closestPlace.lat, lng: closestPlace.lng });
    map.fitBounds(bounds);

    if (map.getZoom() > 17) {
      map.setZoom(17);
    }
  }, [map, places, userLocation]);

  if (loadError) {
    return (
      <div className="map-view-status map-view-status--error">
        Map failed to load. Check your Google Maps API key and that Places is enabled.
      </div>
    );
  }

  if (!isLoaded) {
    return <div className="map-view-status">Loading map…</div>;
  }

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="map-view-status map-view-status--error">
        Set VITE_GOOGLE_MAPS_API_KEY in your environment to show the map.
      </div>
    );
  }

  return (
    <div className="map-view-root">
      <div className="map-view">
        <GoogleMap
          mapContainerStyle={mapContainerStyle}
          mapContainerClassName="map-view__canvas"
          options={mapOptions}
          center={mapCenter}
          zoom={userLocation ? 15 : 12}
          clickableIcons={false}
          onClick={() => setSelectedPlace(null)}
          onLoad={(mapInstance) => setMap(mapInstance)}
          onUnmount={() => setMap(null)}
        >
      {userLocation && (
        <>
          <Marker
            position={userLocation}
            icon={{
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: '#D4AF37',
              fillOpacity: 1,
              strokeColor: '#0B0B0B',
              strokeWeight: 2,
            }}
          />

          <Circle
            center={userLocation}
            radius={50}
            options={{
              fillColor: '#D4AF37',
              fillOpacity: 0.2,
              strokeOpacity: 0,
            }}
          />
        </>
      )}

      {places.map((place) => {
        const loc = place.geometry?.location;
        if (!loc || (shouldFilterVisiblePlaces && !visiblePlaceIdSet.has(place.place_id))) return null;
        return (
          <Marker
            key={place.place_id || `${loc.lat()}-${loc.lng()}`}
            position={{ lat: loc.lat(), lng: loc.lng() }}
            icon={bathroomIcon}
            onClick={() => setSelectedPlace(place)}
          />
        );
      })}

      {selectedPlace?.geometry?.location && (
        <InfoWindow
          position={{
            lat: selectedPlace.geometry.location.lat(),
            lng: selectedPlace.geometry.location.lng(),
          }}
          onCloseClick={() => setSelectedPlace(null)}
        >
          <div className="map-info-window">
            <button
              type="button"
              className="map-info-window__close"
              onClick={() => setSelectedPlace(null)}
              aria-label="Close restroom details"
            >
              X
            </button>
            <br/>
            {(() => {
              const placeId = selectedPlace.place_id;
              const locationId = placeId ? locationIdByPlaceId?.[placeId] : null;
              const summary = locationId ? reviewSummaryByLocation?.[locationId] : null;
              const average = summary?.average_rating;
              return average != null ? (
                <p className="map-info-window__rating">
                  {renderStars(average)} ({average}/5)
                </p>
              ) : (
                <p className="map-info-window__no-reviews">No Reviews</p>
              );
            })()}
            <h3 className="map-info-window__title">{selectedPlace.name}</h3>
            <p className="map-info-window__address">{selectedPlace.vicinity}</p>
            {(() => {
              const placeId = selectedPlace.place_id;
              const locationId = placeId ? locationIdByPlaceId?.[placeId] : null;
              const summary = locationId ? reviewSummaryByLocation?.[locationId] : null;
              const isFavorited = locationId ? favoriteLocationIds?.includes(locationId) : false;
              return (
                <div className="map-info-window__actions">
                  {summary?.average_rating != null && (
                    <p className="map-info-window__review-count">
                      {summary.review_count} review{summary.review_count === 1 ? '' : 's'}
                    </p>
                  )}
                  {locationId && (
                    <button
                      type="button"
                      className="map-info-window__btn map-info-window__btn--secondary"
                      onClick={() => onToggleFavorite?.(locationId, !isFavorited)}
                      disabled={favoriteLoadingId === locationId}
                    >
                      🔖{' '}
                      {favoriteLoadingId === locationId
                        ? 'Saving...'
                        : !isLoggedIn
                          ? 'Sign in to bookmark'
                          : isFavorited
                            ? 'Bookmarked'
                            : 'Bookmark'}
                    </button>
                  )}
                  <button
                    type="button"
                    className="map-info-window__btn"
                    onClick={() => {
                      if (!locationId) return;
                      if (isLoggedIn) {
                        onLeaveReview?.(locationId, true);
                      } else {
                        onRequireLogin?.();
                      }
                    }}
                    disabled={!locationId}
                  >
                    {isLoggedIn ? 'Leave a review' : 'Login or Signup to leave a review'}
                  </button>
                </div>
              );
            })()}
          </div>
        </InfoWindow>
      )}
        </GoogleMap>
      </div>
      {showNoNearbyMessage && (
        <p className="map-view-message">
          No nearby public toliets
        </p>
      )}
    </div>
  );
}
